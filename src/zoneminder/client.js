// -----------------------------------------------------------------------------
// HTTP client of one ZoneMinder server (1.34 and later: the JWT API).
//
// What the integration uses, all under the web root of ZoneMinder (`/zm` on a
// packaged install, `/` on some containers: both are tried when the address
// has no path):
//   POST api/host/login.json                       user + pass → access token
//                                                  (2 h); auth off → null token
//   GET  api/monitors.json                         monitors, their status
//   POST api/monitors/<id>.json                    Monitor[Function] (1.36) or
//                                                  Monitor[Analysing|Recording]
//                                                  (1.37+, Function is ignored)
//   GET  api/monitors/alarm/id:<id>/command:status.json   alarm state 0..4
//   GET  api/monitors/alarm/id:<id>/command:on|off.json   forced alarm
//   GET  api/events/index/<conditions>.json        events (new ones, today's)
//   GET  api/configs/viewByName/ZM_PATH_ZMS.json   where nph-zms lives
//   GET  <ZM_PATH_ZMS>?mode=single&monitor=<id>    one JPEG frame
//
// Found on real servers (1.36.4 and 1.38.6, see CLAUDE.md): 1.36 writes every
// number as a string, 1.38 as a number; a 401 says "Insufficient privileges"
// for an account that may not write, and anything else for a token gone; the
// body of an error repeats the request URL, token included: never logged.
//
// Errors carry a `kind`: `network` (no answer), `auth` (account refused),
// `apiDisabled` (the account may not use the API), `permission` (the account
// may not do this), `http` (an answer, not the expected one).
// -----------------------------------------------------------------------------

export const REQUEST_TIMEOUT_MS = 15000;
const MAX_JSON_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
// Log in again this long before the access token ends (it lasts 2 h).
const TOKEN_MARGIN_MS = 5 * 60 * 1000;

// The five functions of ZoneMinder, the vocabulary of the integration (keys
// of the `mode` feature, the scene action and the widget: forever).
export const MODES = ['monitor', 'modect', 'record', 'mocord', 'nodect'];
const FUNCTION_OF_MODE = {
  monitor: 'Monitor',
  modect: 'Modect',
  record: 'Record',
  mocord: 'Mocord',
  nodect: 'Nodect',
};
// ZoneMinder 1.37+ splits the function in three settings. Nodect (record
// when told by another program) is Recording OnMotion without analysis.
const SETTINGS_OF_MODE = {
  monitor: { Analysing: 'None', Recording: 'None' },
  modect: { Analysing: 'Always', Recording: 'OnMotion' },
  record: { Analysing: 'None', Recording: 'Always' },
  mocord: { Analysing: 'Always', Recording: 'Always' },
  nodect: { Analysing: 'None', Recording: 'OnMotion' },
};
// The modes in which ZoneMinder analyses frames: the only ones where a forced
// alarm is taken (1.36 refuses the others, 1.38 hangs on them).
export const ALARM_MODES = ['modect', 'mocord', 'nodect'];

export const ALARM_STATES = { IDLE: 0, PREALARM: 1, ALARM: 2, ALERT: 3, TAPE: 4 };

export class ZoneMinderError extends Error {
  constructor(message, { kind = 'http', status } = {}) {
    super(message);
    this.name = 'ZoneMinderError';
    this.kind = kind;
    this.status = status;
  }
}

/**
 * The address typed by the user: `192.0.2.10`, `http://nas.lan:8080/zm`,
 * `https://cams.example/`… Resolves to `{ origin, basePath }` (basePath null
 * when none was typed), or null. Credentials in the address are refused.
 */
export function parseServerUrl(text) {
  const raw = String(text ?? '').trim();
  if (!raw) {
    return null;
  }
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`);
  } catch {
    return null;
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    !url.hostname
  ) {
    return null;
  }
  const path = url.pathname.replace(/\/+$/, '');
  // `http://host/` says "the root"; `http://host` says nothing.
  const typedPath = /^[a-z]+:\/\/[^/]+\//i.test(raw) || /^[^/:]+(:\d+)?\//.test(raw);
  return { origin: url.origin, basePath: path || (typedPath ? '' : null) };
}

const number = (value) => (value === null || value === undefined ? NaN : Number(value));

/** One monitor of `monitors.json`, the same for 1.36 (strings) and 1.38. */
export function normalizeMonitor(entry) {
  const monitor = entry?.Monitor ?? {};
  const status = entry?.Monitor_Status ?? {};
  const split = 'Capturing' in monitor;
  let mode;
  let capturing;
  if (split) {
    capturing = monitor.Capturing !== 'None';
    mode =
      MODES.find((key) => {
        const settings = SETTINGS_OF_MODE[key];
        return settings.Analysing === monitor.Analysing && settings.Recording === monitor.Recording;
      }) ?? null;
  } else {
    capturing = monitor.Function !== 'None';
    mode = MODES.find((key) => FUNCTION_OF_MODE[key] === monitor.Function) ?? null;
  }
  return {
    id: number(monitor.Id),
    name: String(monitor.Name ?? '').trim(),
    enabled: number(monitor.Enabled) === 1 && capturing,
    mode,
    split,
    deleted: monitor.Deleted === true || monitor.Deleted === '1' || monitor.Deleted === 1,
    serverId: monitor.ServerId ?? null,
    // Only "Connected" means frames are coming in: "Running" is said of a
    // capture process still waiting for its camera.
    connected: status.Status === 'Connected',
    status: status.Status ?? null,
  };
}

/** One event of `events/index`. */
export function normalizeEvent(entry) {
  const event = entry?.Event ?? {};
  return {
    id: number(event.Id),
    monitorId: number(event.MonitorId),
    cause: String(event.Cause ?? '').trim(),
    notes: String(event.Notes ?? '').trim(),
    score: Number.isFinite(number(event.MaxScore)) ? number(event.MaxScore) : 0,
    start: String(event.StartDateTime ?? event.StartTime ?? ''),
    ended: Boolean(event.EndDateTime ?? event.EndTime),
  };
}

/** What kind of event, from its free-text cause: a filter for scenes. */
export function eventKind(cause) {
  const text = String(cause ?? '').toLowerCase();
  if (text.startsWith('motion')) {
    return 'motion';
  }
  if (text.startsWith('forced')) {
    return 'forced';
  }
  if (text.startsWith('continuous')) {
    return 'continuous';
  }
  if (text.startsWith('signal')) {
    return 'signal';
  }
  if (text.startsWith('linked')) {
    return 'linked';
  }
  return 'other';
}

const scrub = (text) => String(text ?? '').replace(/token=[^&\s"']+/g, 'token=…');

/** The message of an API error body, without the URL it repeats. */
function apiMessage(body) {
  if (!body || typeof body !== 'object') {
    return '';
  }
  const text = body.data?.message ?? body.message ?? body.name ?? '';
  return scrub(typeof text === 'string' ? text : JSON.stringify(text)).slice(0, 200);
}

async function readLimited(response, limit) {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > limit) {
    await response.body?.cancel().catch(() => {});
    throw new ZoneMinderError(`Answer too large (${length} bytes)`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > limit) {
    throw new ZoneMinderError(`Answer too large (${buffer.length} bytes)`);
  }
  return buffer;
}

const isJpeg = (buffer) => buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8;

export class ZoneMinderClient {
  /**
   * @param {object} options
   * @param {string} options.url the server address (parseServerUrl)
   * @param {string} [options.username] empty when ZoneMinder has no login
   * @param {string} [options.password]
   * @param {Function} [options.fetch] fetch (tests replace it)
   */
  constructor({ url, username = '', password = '', fetch = globalThis.fetch }) {
    const server = parseServerUrl(url);
    if (!server) {
      throw new ZoneMinderError('Invalid ZoneMinder address', { kind: 'config' });
    }
    this.origin = server.origin;
    this.typedPath = server.basePath;
    this.basePath = server.basePath ?? '/zm';
    this.username = username;
    this.password = password ?? '';
    this.fetch = fetch;
    this.token = null;
    this.tokenUntil = 0;
    this.loggedIn = false;
    this.version = null;
    this.zmsPath = null;
    this.loggingIn = null;
  }

  /** The address without credentials, for messages and logs. */
  get label() {
    return `${this.origin}${this.basePath}`;
  }

  async send(url, { method = 'GET', form = null, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
    try {
      return await this.fetch(url, {
        method,
        body: form ? new URLSearchParams(form).toString() : undefined,
        headers: form ? { 'content-type': 'application/x-www-form-urlencoded' } : {},
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const reason = err?.name === 'TimeoutError' ? 'timeout' : (err?.cause?.code ?? err?.message);
      throw new ZoneMinderError(`${this.label} does not answer (${scrub(reason)})`, {
        kind: 'network',
      });
    }
  }

  async readJson(response) {
    const buffer = await readLimited(response, MAX_JSON_BYTES);
    try {
      return JSON.parse(buffer.toString('utf8'));
    } catch {
      return undefined;
    }
  }

  // --- Login ---------------------------------------------------------------------

  /** Log in (once at a time), finding the web root of ZoneMinder on the way. */
  login() {
    this.loggingIn ??= this.doLogin().finally(() => {
      this.loggingIn = null;
    });
    return this.loggingIn;
  }

  async doLogin() {
    // `/zm` first (packages), then the root (some containers).
    const paths = this.typedPath === null ? ['/zm', ''] : [this.typedPath];
    let lastError = null;
    for (const path of paths) {
      try {
        await this.loginAt(path);
        this.basePath = path;
        return;
      } catch (err) {
        lastError = err;
        if (err.kind !== 'notFound') {
          this.basePath = path;
          throw err;
        }
      }
    }
    throw new ZoneMinderError(`No ZoneMinder API at ${this.origin}${paths.join(' or ')}`, {
      kind: 'http',
      status: lastError?.status,
    });
  }

  async loginAt(path) {
    const form = this.username ? { user: this.username, pass: this.password } : {};
    const response = await this.send(`${this.origin}${path}/api/host/login.json`, {
      method: 'POST',
      form,
    });
    const body = await this.readJson(response);
    if (response.status === 404 || (response.ok && (body === undefined || body === null))) {
      throw new ZoneMinderError('Not found', { kind: 'notFound', status: response.status });
    }
    if (response.status === 401) {
      const message = apiMessage(body);
      if (/api disabled/i.test(message)) {
        throw new ZoneMinderError(`ZoneMinder: ${message}`, { kind: 'apiDisabled', status: 401 });
      }
      throw new ZoneMinderError(`ZoneMinder refuses the account (${message || 'HTTP 401'})`, {
        kind: 'auth',
        status: 401,
      });
    }
    if (!response.ok || typeof body !== 'object') {
      throw new ZoneMinderError(`ZoneMinder login answered HTTP ${response.status}`, {
        status: response.status,
      });
    }
    // Auth turned off in ZoneMinder: a 200 with a null token, nothing to send.
    this.token = typeof body.access_token === 'string' ? body.access_token : null;
    const seconds = Number(body.access_token_expires);
    this.tokenUntil = this.token
      ? Date.now() + (Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 3600 * 1000)
      : Infinity;
    if (!this.token && this.username && body.access_token === undefined) {
      // A ZoneMinder older than 1.34 (no JWT): not supported.
      throw new ZoneMinderError('ZoneMinder is too old: version 1.34 or later is needed', {
        kind: 'http',
      });
    }
    this.version = typeof body.version === 'string' ? body.version : this.version;
    this.loggedIn = true;
  }

  async ensureLogin() {
    if (!this.loggedIn || Date.now() > this.tokenUntil - TOKEN_MARGIN_MS) {
      await this.login();
    }
  }

  withToken(url) {
    if (!this.token) {
      return url;
    }
    return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(this.token)}`;
  }

  // --- API -----------------------------------------------------------------------

  /** One API call (`path` under `api/`), logging in again once on a 401. */
  async api(path, { method = 'GET', form = null, timeoutMs } = {}, retried = false) {
    await this.ensureLogin();
    const response = await this.send(this.withToken(`${this.origin}${this.basePath}/api/${path}`), {
      method,
      form,
      timeoutMs,
    });
    const body = await this.readJson(response);
    if (response.status === 401) {
      const message = apiMessage(body);
      if (/privilege/i.test(message)) {
        throw new ZoneMinderError(`ZoneMinder: ${message}`, { kind: 'permission', status: 401 });
      }
      if (!retried) {
        // The token ended (ZoneMinder restarted, or its secret changed).
        this.loggedIn = false;
        return this.api(path, { method, form, timeoutMs }, true);
      }
      throw new ZoneMinderError(`ZoneMinder refuses the account (${message || 'HTTP 401'})`, {
        kind: 'auth',
        status: 401,
      });
    }
    if (!response.ok || body === undefined) {
      const message = apiMessage(body);
      throw new ZoneMinderError(
        `ZoneMinder answered HTTP ${response.status} to ${path.split(/[/?]/)[0]}${message ? `: ${message}` : ''}`,
        { status: response.status },
      );
    }
    return body;
  }

  async listMonitors() {
    const body = await this.api('monitors.json');
    if (!Array.isArray(body?.monitors)) {
      throw new ZoneMinderError('ZoneMinder sent no monitor list');
    }
    return body.monitors
      .map(normalizeMonitor)
      .filter((monitor) => Number.isInteger(monitor.id) && !monitor.deleted);
  }

  /** 0 idle, 1 pre-alarm, 2 alarm, 3 alert, 4 tape (ZoneMinder's states). */
  async alarmState(id) {
    const body = await this.api(`monitors/alarm/id:${id}/command:status.json`);
    const state = number(body?.status);
    if (!Number.isInteger(state)) {
      throw new ZoneMinderError(`No alarm state for monitor ${id}`);
    }
    return state;
  }

  async forceAlarm(id, on) {
    const body = await this.api(`monitors/alarm/id:${id}/command:${on ? 'on' : 'off'}.json`);
    // 1.36 answers 200 with this sentence on a monitor that does not analyse.
    if (/cannot handle alarms/i.test(String(body?.status ?? ''))) {
      throw new ZoneMinderError(`Monitor ${id} does not analyse its images`, { kind: 'mode' });
    }
  }

  /** Change the function of a monitor, the 1.36 way or the 1.37+ way. */
  async setMode(monitor, mode) {
    if (!MODES.includes(mode)) {
      throw new ZoneMinderError(`Unknown mode ${mode}`, { kind: 'config' });
    }
    const form = monitor.split
      ? Object.fromEntries(
          Object.entries({ Capturing: 'Always', ...SETTINGS_OF_MODE[mode] }).map(([key, value]) => [
            `Monitor[${key}]`,
            value,
          ]),
        )
      : { 'Monitor[Function]': FUNCTION_OF_MODE[mode] };
    const body = await this.api(`monitors/${monitor.id}.json`, { method: 'POST', form });
    // Validation errors come back in a 200.
    if (body?.message !== 'Saved') {
      throw new ZoneMinderError(`ZoneMinder did not save monitor ${monitor.id}`);
    }
  }

  async events(conditions, query = {}) {
    const path = conditions.map((condition) => encodeURIComponent(condition)).join('/');
    const params = new URLSearchParams(query).toString();
    const body = await this.api(`events/index/${path}.json${params ? `?${params}` : ''}`);
    if (!Array.isArray(body?.events)) {
      throw new ZoneMinderError('ZoneMinder sent no event list');
    }
    return {
      events: body.events.map(normalizeEvent).filter((event) => Number.isInteger(event.id)),
      count: Number(body.pagination?.count ?? body.events.length),
    };
  }

  /** The events after `lastId`, oldest first. */
  async eventsAfter(lastId, limit = 50) {
    const { events } = await this.events([`Id >:${lastId}`], {
      sort: 'Id',
      direction: 'asc',
      limit,
    });
    return events;
  }

  /** The id of the last event, 0 if there is none. */
  async lastEventId() {
    const { events } = await this.events([`Id >:0`], { sort: 'Id', direction: 'desc', limit: 1 });
    return events[0]?.id ?? 0;
  }

  /** How many events of a monitor started since `since` (server local time). */
  async countEvents(monitorId, since) {
    const { count } = await this.events([`MonitorId:${monitorId}`, `StartDateTime >=:${since}`], {
      limit: 1,
    });
    return Number.isFinite(count) ? count : 0;
  }

  async zms() {
    if (!this.zmsPath) {
      try {
        const body = await this.api('configs/viewByName/ZM_PATH_ZMS.json');
        const value = String(body?.config?.Value ?? '');
        this.zmsPath = value.startsWith('/') ? value : null;
      } catch (err) {
        if (err.kind === 'auth' || err.kind === 'network') {
          throw err;
        }
      }
      this.zmsPath ??= `${this.basePath}/cgi-bin/nph-zms`;
    }
    return this.zmsPath;
  }

  /** The current frame of a monitor (JPEG), `scale` in percent. */
  async image(id, { scale = 100 } = {}, retried = false) {
    await this.ensureLogin();
    const path = await this.zms();
    const response = await this.send(
      this.withToken(`${this.origin}${path}?mode=single&monitor=${id}&scale=${scale}`),
    );
    const buffer = await readLimited(response, MAX_IMAGE_BYTES);
    if (response.ok && isJpeg(buffer)) {
      return buffer;
    }
    // A token refused: 403 (1.36) or an empty 200 (1.38).
    if (!retried && (response.status === 403 || (response.ok && buffer.length === 0))) {
      this.loggedIn = false;
      return this.image(id, { scale }, true);
    }
    throw new ZoneMinderError(`No image of monitor ${id} (HTTP ${response.status})`, {
      status: response.status,
    });
  }
}
