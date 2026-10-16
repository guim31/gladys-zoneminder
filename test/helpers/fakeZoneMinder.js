// -----------------------------------------------------------------------------
// A simulated ZoneMinder server behind the `fetch` seam of the client, built
// on answers RECORDED from real servers (test/fixtures/zoneminder):
//   - `1.36`: web root `/zm`, numbers as strings, `Function` drives the
//     monitor, a refused image token is a 403;
//   - `1.38`: web root `/`, numbers as numbers, `Capturing`/`Analysing`/
//     `Recording` drive it (`Function` is stored and ignored), a refused image
//     token is an empty 200.
// Login gives a token; a 401 "Insufficient privileges" for a viewer's writes.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

const FIXTURES = new URL('../fixtures/zoneminder/', import.meta.url);

export const FRAME = readFileSync(new URL('frame.jpg', FIXTURES));

export const fixture = (version) =>
  JSON.parse(readFileSync(new URL(`zm-${version}.json`, FIXTURES), 'utf8'));

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=UTF-8' },
  });

const unauthorized = (message) =>
  json(401, {
    success: false,
    data: { name: message, message, url: '/zm/api/x.json?token=LEAKED', exception: {} },
  });

export class FakeZoneMinder {
  constructor({ version = '1.36', username = 'admin', password = 'secret', auth = true } = {}) {
    this.version = version;
    this.username = username;
    this.password = password;
    this.auth = auth;
    this.viewer = false;
    this.apiEnabled = true;
    const data = fixture(version);
    this.split = version !== '1.36';
    this.root = this.split ? '' : '/zm';
    this.monitors = new Map(
      data.monitors.monitors.map((entry) => [Number(entry.Monitor.Id), structuredClone(entry)]),
    );
    this.eventTemplate = data.events.events[0];
    this.events = [];
    this.alarm = new Map();
    this.forced = new Set();
    this.frames = new Map();
    this.down = false;
    this.tokens = new Set();
    this.serial = 0;
    this.requests = [];
    this.writes = [];
    this.fetch = (url, options) => this.handle(url, options);
  }

  // --- Scenario helpers ----------------------------------------------------------

  /** Set a field of a monitor, in the type this version writes. */
  set(id, field, value) {
    this.monitors.get(id).Monitor[field] = this.typed(value);
  }

  typed(value) {
    if (this.split || typeof value !== 'number') {
      return value;
    }
    return String(value);
  }

  setStatus(id, status) {
    this.monitors.get(id).Monitor_Status.Status = status;
  }

  addEvent(monitorId, { cause = 'Motion', score = 42, start = '2026-10-16 10:00:00' } = {}) {
    const id = this.events.length + 100;
    this.events.push({
      Event: {
        ...this.eventTemplate.Event,
        Id: this.typed(id),
        MonitorId: this.typed(monitorId),
        Cause: cause,
        MaxScore: this.typed(score),
        StartDateTime: start,
        EndDateTime: null,
      },
    });
    return id;
  }

  expireTokens() {
    this.tokens.clear();
  }

  // --- HTTP ------------------------------------------------------------------------

  async handle(url, { method = 'GET', body } = {}) {
    const parsed = new URL(url);
    this.requests.push({ method, path: parsed.pathname, query: parsed.search });
    if (this.down) {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    }
    const path = decodeURIComponent(parsed.pathname);
    if (!path.startsWith(`${this.root}/`)) {
      return new Response('<html>Not Found</html>', { status: 404 });
    }
    const rest = path.slice(this.root.length);
    const form = new URLSearchParams(body ?? '');
    if (rest === '/api/host/login.json' && method === 'POST') {
      return this.login(form);
    }
    const token = parsed.searchParams.get('token');
    const allowed = !this.auth || this.tokens.has(token);
    if (rest === '/cgi-bin/nph-zms') {
      if (!allowed) {
        return this.split ? new Response('', { status: 200 }) : new Response('', { status: 403 });
      }
      const id = Number(parsed.searchParams.get('monitor'));
      const scale = Number(parsed.searchParams.get('scale') ?? 100);
      const frame = this.frames.get(id) ?? FRAME;
      const bytes = scale < 100 ? FRAME : frame;
      return new Response(bytes, { status: 200, headers: { 'content-type': 'image/jpeg' } });
    }
    if (!rest.startsWith('/api/')) {
      return new Response('<html>Not Found</html>', { status: 404 });
    }
    if (!allowed) {
      return unauthorized(token ? 'Wrong number of segments' : 'Not Authenticated');
    }
    return this.api(rest.slice('/api/'.length), method, form, parsed.searchParams);
  }

  login(form) {
    if (!this.auth) {
      return json(200, { access_token: null, version: this.version });
    }
    if (form.get('user') !== this.username || form.get('pass') !== this.password) {
      return unauthorized(`Login denied for user "${form.get('user')}"`);
    }
    if (!this.apiEnabled) {
      return unauthorized(`API disabled for: ${this.username}`);
    }
    this.serial += 1;
    const token = `token-${this.serial}`;
    this.tokens.add(token);
    return json(200, {
      access_token: token,
      access_token_expires: 7200,
      refresh_token: `refresh-${this.serial}`,
      refresh_token_expires: 86400,
      version: this.version === '1.36' ? '1.36.4' : '1.38.6',
      apiversion: '2.0',
    });
  }

  api(path, method, form, query) {
    if (path === 'monitors.json') {
      return json(200, { monitors: [...this.monitors.values()] });
    }
    if (path === 'configs/viewByName/ZM_PATH_ZMS.json') {
      return json(200, { config: { Value: `${this.root}/cgi-bin/nph-zms` } });
    }
    let match = /^monitors\/alarm\/id:(\d+)\/command:(\w+)\.json$/.exec(path);
    if (match) {
      return this.alarmCommand(Number(match[1]), match[2]);
    }
    match = /^monitors\/(\d+)\.json$/.exec(path);
    if (match && method === 'POST') {
      return this.edit(Number(match[1]), form);
    }
    match = /^events\/index\/(.+)\.json$/.exec(path);
    if (match) {
      return this.eventIndex(match[1].split('/'), query);
    }
    return json(404, { name: 'Not Found', message: 'Not Found' });
  }

  analyses(id) {
    const monitor = this.monitors.get(id).Monitor;
    return this.split
      ? monitor.Analysing === 'Always'
      : ['Modect', 'Mocord', 'Nodect'].includes(monitor.Function);
  }

  alarmCommand(id, command) {
    if (!this.monitors.has(id)) {
      return json(404, { name: 'Not Found' });
    }
    if (command === 'status') {
      const state = this.forced.has(id) ? 2 : (this.alarm.get(id) ?? 0);
      return json(200, { status: this.typed(state), output: this.typed(state) });
    }
    this.writes.push({ id, command });
    if (command === 'on') {
      if (!this.analyses(id)) {
        if (this.split) {
          return new Response('<html>504 Gateway Time-out</html>', { status: 504 });
        }
        return json(200, {
          status: 'A Monitor in monitor mode cannot handle alarms.  Please use NoDect',
          output: '',
        });
      }
      this.forced.add(id);
      this.addEvent(id, { cause: 'Forced Web', score: 255 });
      return json(200, { status: 'Alarmed event id: 1', output: '' });
    }
    this.forced.delete(id);
    return json(200, { status: 'Cancelling forced alarm on/off', output: '' });
  }

  edit(id, form) {
    if (this.viewer) {
      return unauthorized('Insufficient privileges');
    }
    const monitor = this.monitors.get(id)?.Monitor;
    if (!monitor) {
      return json(404, { name: 'Not Found' });
    }
    const changes = {};
    for (const [key, value] of form) {
      const field = /^Monitor\[(\w+)\]$/.exec(key)?.[1];
      if (field) {
        changes[field] = value;
      }
    }
    if (
      changes.Function &&
      !['None', 'Monitor', 'Modect', 'Record', 'Mocord', 'Nodect'].includes(changes.Function)
    ) {
      return json(200, { message: 'Error Array ( [Function] => … )' });
    }
    this.writes.push({ id, changes });
    Object.assign(monitor, changes);
    return json(200, { message: 'Saved' });
  }

  eventIndex(conditions, query) {
    let events = [...this.events];
    for (const condition of conditions) {
      const [field, value] = condition.split(/:(.*)/s);
      const [name, operator = '='] = field.trim().split(/\s+/);
      events = events.filter((entry) => {
        const actual = entry.Event[name];
        if (operator === '>') {
          return Number(actual) > Number(value);
        }
        if (operator === '>=') {
          return String(actual) >= value;
        }
        return String(actual) === value;
      });
    }
    if (query.get('sort') === 'Id') {
      const sign = query.get('direction') === 'desc' ? -1 : 1;
      events.sort((a, b) => sign * (Number(a.Event.Id) - Number(b.Event.Id)));
    }
    const limit = Number(query.get('limit') ?? 100);
    return json(200, {
      events: events.slice(0, limit),
      pagination: { page: 1, current: 1, count: events.length, limit },
    });
  }
}
