// The ZoneMinder client on the answers recorded from real servers: address
// parsing, both monitor models, events, and errors that never carry a token.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ZoneMinderClient,
  eventKind,
  normalizeEvent,
  normalizeMonitor,
  parseServerUrl,
} from '../src/zoneminder/client.js';
import { FakeZoneMinder, fixture } from './helpers/fakeZoneMinder.js';

test('addresses: with or without scheme, path or port; no credentials', () => {
  assert.deepEqual(parseServerUrl('192.0.2.10'), { origin: 'http://192.0.2.10', basePath: null });
  assert.deepEqual(parseServerUrl('192.0.2.10/'), { origin: 'http://192.0.2.10', basePath: '' });
  assert.deepEqual(parseServerUrl('https://nas.lan:8443/zm/'), {
    origin: 'https://nas.lan:8443',
    basePath: '/zm',
  });
  assert.deepEqual(parseServerUrl('http://nas.lan/'), { origin: 'http://nas.lan', basePath: '' });
  assert.equal(parseServerUrl('http://admin:pw@nas.lan/zm'), null);
  assert.equal(parseServerUrl('ftp://nas.lan'), null);
  assert.equal(parseServerUrl(''), null);
});

test('the recorded monitors of 1.36 and 1.38 read the same', () => {
  const read = (version) => fixture(version).monitors.monitors.map(normalizeMonitor);
  assert.deepEqual(
    read('1.36').map((m) => [m.id, m.name, m.mode, m.enabled, m.connected, m.split]),
    [
      [1, 'Front door', 'modect', true, true, false],
      [2, 'Garage', 'monitor', true, false, false],
      [3, 'Porch', 'nodect', true, true, false],
    ],
  );
  // 1.38 stores Function but runs on Analysing / Recording (Garage says
  // "Mocord" in Function, and analyses nothing).
  assert.deepEqual(
    read('1.38').map((m) => [m.id, m.name, m.mode, m.enabled, m.connected, m.split]),
    [
      [1, 'Front door', 'modect', true, true, true],
      [2, 'Garage', 'monitor', true, false, true],
      [3, 'Porch', 'modect', true, true, true],
    ],
  );
  const off = normalizeMonitor({ Monitor: { Id: '4', Function: 'None', Enabled: '1' } });
  assert.equal(off.enabled, false);
});

test('events and their kind', () => {
  const [event] = fixture('1.38').events.events.map(normalizeEvent);
  assert.deepEqual([event.id, event.monitorId, event.cause, event.score], [1, 1, 'Motion:All', 15]);
  assert.equal(eventKind('Motion:All'), 'motion');
  assert.equal(eventKind('Forced Web'), 'forced');
  assert.equal(eventKind('Continuous'), 'continuous');
  assert.equal(eventKind('Signal'), 'signal');
  assert.equal(eventKind('Linked'), 'linked');
  assert.equal(eventKind('ONVIF'), 'other');
});

test('errors never carry the token ZoneMinder repeats in its answers', async () => {
  const server = new FakeZoneMinder();
  const client = new ZoneMinderClient({
    url: '192.0.2.10',
    username: 'admin',
    password: 'secret',
    fetch: server.fetch,
  });
  await client.listMonitors();
  server.viewer = true;
  const err = await client.setMode({ id: 1, split: false }, 'record').then(
    () => null,
    (error) => error,
  );
  assert.equal(err.kind, 'permission');
  assert.doesNotMatch(err.message, /token|LEAKED|secret/);
});

test('a 1.38 server under / is found after /zm; images come back as JPEG', async () => {
  const server = new FakeZoneMinder({ version: '1.38' });
  const client = new ZoneMinderClient({
    url: 'http://192.0.2.10',
    username: 'admin',
    password: 'secret',
    fetch: server.fetch,
  });
  const image = await client.image(1);
  assert.equal(client.basePath, '');
  assert.equal(image[0], 0xff);
  // A refused token: an empty 200 on 1.38, logged in again once.
  server.expireTokens();
  assert.equal((await client.image(1))[1], 0xd8);
});

test('an address with a path is used as typed', async () => {
  const server = new FakeZoneMinder({ version: '1.38' });
  const client = new ZoneMinderClient({
    url: 'http://192.0.2.10/zm',
    username: 'admin',
    password: 'secret',
    fetch: server.fetch,
  });
  const err = await client.listMonitors().then(
    () => null,
    (error) => error,
  );
  assert.match(err.message, /No ZoneMinder API at http:\/\/192\.0\.2\.10\/zm/);
});
