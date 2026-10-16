// The integration end to end, against the SDK's fake Gladys and a simulated
// ZoneMinder (1.36 and 1.38 answers): discovery, states, images, triggers,
// modes, forced alarms, scene actions, the manifest action.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRIGGERS } from '../src/hub.js';
import { DEFAULT_CONFIG, FakeZoneMinder, createAll, createWorld } from './helpers/world.js';

function idOf(world, monitor, feature) {
  const ids = world.hub.ids({ id: monitor });
  return feature ? ids.feature(feature) : ids.device;
}

const lastState = (world, monitor, feature) => world.fake.lastState(idOf(world, monitor, feature));

for (const version of ['1.36', '1.38']) {
  test(`ZoneMinder ${version}: one device per monitor, without the Gladys scheduler`, async (t) => {
    const world = await createWorld({ server: new FakeZoneMinder({ version }) });
    t.after(() => world.app.stop());
    assert.deepEqual(
      world.fake.discoveredDevices.map((device) => [device.name, device.should_poll]),
      [
        ['Front door', false],
        ['Garage', false],
        ['Porch', false],
      ],
    );
    assert.deepEqual(world.fake.connectionStatus, { connected: true });
    // The web root found on the way: /zm for 1.36, / for 1.38.
    assert.equal(world.hub.client.basePath, version === '1.36' ? '/zm' : '');
  });

  test(`ZoneMinder ${version}: adding the monitors publishes mode, capture, counts, images`, async (t) => {
    const server = new FakeZoneMinder({ version });
    server.addEvent(1, { start: '2026-10-16 08:00:00' });
    server.addEvent(1, { start: '2026-10-15 23:00:00' });
    const world = await createWorld({ server });
    t.after(() => world.app.stop());
    await createAll(world);
    // Front door: Modect in 1.36; Analysing + OnMotion in 1.38.
    assert.equal(lastState(world, 1, 'mode'), 'modect');
    // Garage: Monitor, and no frames (its camera does not answer).
    assert.equal(lastState(world, 2, 'mode'), 'monitor');
    assert.equal(lastState(world, 3, 'mode'), version === '1.36' ? 'nodect' : 'modect');
    assert.equal(lastState(world, 1, 'enabled'), 1);
    assert.equal(lastState(world, 1, 'events-today'), 1);
    assert.equal(lastState(world, 1, 'alarm'), 0);
    const transports = Object.fromEntries(
      world.fake.transports.map((entry) => [entry.device_external_id, entry.transport]),
    );
    assert.equal(transports[idOf(world, 1)], 'local');
    assert.equal(transports[idOf(world, 2)], 'unreachable');
    // The image goes with the DEVICE external id (the core answers 404 to a feature's).
    const images = new Set(world.fake.cameraImages.map((image) => image.device_external_id));
    assert.ok(images.has(idOf(world, 1)) && images.has(idOf(world, 3)));
    assert.match(world.fake.cameraImages[0].image, /^image\/jpg;base64,\/9j\//);
    assert.ok(world.fake.widgetRefreshes.includes('camera'));
  });
}

test('an alarm: the state, an image at once, and back to quiet', async (t) => {
  const world = await createWorld({ config: { ...DEFAULT_CONFIG, snapshot_interval: '900' } });
  t.after(() => world.app.stop());
  await createAll(world);
  await world.hub.pollAll();
  const before = world.fake.cameraImages.length;
  world.server.alarm.set(1, 2);
  await world.hub.pollAll();
  assert.equal(lastState(world, 1, 'alarm'), 1);
  assert.equal(world.fake.cameraImages.length, before + 1);
  // Alert (the frames after the alarm) is still the same alarm.
  world.server.alarm.set(1, 3);
  await world.hub.pollAll();
  assert.equal(world.fake.cameraImages.length, before + 1);
  world.server.alarm.set(1, 0);
  await world.hub.pollAll();
  assert.equal(lastState(world, 1, 'alarm'), 0);
});

test('a new event fires the trigger with its cause, kind and score, once', async (t) => {
  const world = await createWorld({ config: { ...DEFAULT_CONFIG, snapshot_interval: '900' } });
  t.after(() => world.app.stop());
  // An event from before the start is not news.
  world.server.addEvent(1);
  await createAll(world);
  await world.hub.pollAll();
  assert.deepEqual(world.fake.sceneEvents, []);
  const id = world.server.addEvent(3, { cause: 'Motion:All', score: 18 });
  world.server.addEvent(1, { cause: 'Continuous', score: 0 });
  const before = world.fake.cameraImages.length;
  await world.hub.pollAll();
  await world.hub.idle();
  assert.deepEqual(world.fake.sceneEvents, [
    {
      key: TRIGGERS.EVENT,
      data: {
        camera: idOf(world, 3),
        camera_name: 'Porch',
        kind: 'motion',
        cause: 'Motion:All',
        score: 18,
        event_id: id,
      },
    },
    {
      key: TRIGGERS.EVENT,
      data: {
        camera: idOf(world, 1),
        camera_name: 'Front door',
        kind: 'continuous',
        cause: 'Continuous',
        score: 0,
        event_id: id + 1,
      },
    },
  ]);
  assert.equal(world.fake.cameraImages.length, before + 2);
  assert.equal(lastState(world, 3, 'events-today'), 1);
  await world.hub.pollAll();
  await world.hub.idle();
  assert.equal(world.fake.sceneEvents.length, 2);
});

test('a monitor without frames goes offline once, after two checks, then comes back', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createAll(world);
  world.server.setStatus(1, 'Running');
  await world.hub.refresh();
  assert.equal(world.fake.sceneEvents.length, 0, 'one check is not enough');
  await world.hub.refresh();
  await world.hub.refresh();
  await world.hub.idle();
  assert.deepEqual(world.fake.sceneEvents, [
    { key: TRIGGERS.OFFLINE, data: { camera: idOf(world, 1), camera_name: 'Front door' } },
  ]);
  assert.equal(world.fake.transports.at(-1).transport, 'unreachable');
  world.server.setStatus(1, 'Connected');
  await world.hub.refresh();
  assert.equal(world.fake.transports.at(-1).transport, 'local');
});

test('a monitor turned off in ZoneMinder: capture 0, no offline trigger', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createAll(world);
  world.server.set(1, 'Enabled', 0);
  world.server.setStatus(1, 'NotRunning');
  await world.hub.refresh();
  await world.hub.refresh();
  await world.hub.idle();
  assert.equal(lastState(world, 1, 'enabled'), 0);
  assert.deepEqual(world.fake.sceneEvents, []);
});

for (const version of ['1.36', '1.38']) {
  test(`ZoneMinder ${version}: the mode list of the dashboard writes the right fields`, async (t) => {
    const world = await createWorld({ server: new FakeZoneMinder({ version }) });
    t.after(() => world.app.stop());
    await createAll(world);
    const device = world.fake.discoveredDevices[1];
    const feature = device.features.find((item) => item.external_id.endsWith(':mode'));
    const ack = await world.fake.setValue(device, feature, 'mocord');
    assert.equal(ack.success, true, ack.error);
    assert.deepEqual(
      world.server.writes.at(-1).changes,
      version === '1.36'
        ? { Function: 'Mocord' }
        : { Capturing: 'Always', Analysing: 'Always', Recording: 'Always' },
    );
    assert.equal(lastState(world, 2, 'mode'), 'mocord');
    await world.hub.refresh();
    assert.equal(lastState(world, 2, 'mode'), 'mocord', 'read back from ZoneMinder');
    // Another feature, or an unknown mode: refused.
    const alarm = device.features.find((item) => item.external_id.endsWith(':alarm'));
    assert.equal((await world.fake.setValue(device, alarm, 1)).success, false);
    assert.equal((await world.fake.setValue(device, feature, 'none')).success, false);
  });
}

test('scene action: every monitor in Modect at once, only those that change', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createAll(world);
  const ack = await world.fake.sceneAction('set_mode', { mode: 'modect' });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(ack.data.outputs, { cameras: 2 });
  assert.deepEqual(
    world.server.writes.map((write) => write.id),
    [2, 3],
  );
  assert.equal(lastState(world, 3, 'mode'), 'modect');
});

test('scene action: a forced alarm starts and is cancelled; refused without analysis', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createAll(world);
  const porch = idOf(world, 3);
  let ack = await world.fake.sceneAction('force_alarm', { camera: porch, command: 'start' });
  assert.equal(ack.success, true, ack.error);
  assert.equal(lastState(world, 3, 'alarm'), 1);
  ack = await world.fake.sceneAction('force_alarm', { camera: porch, command: 'cancel' });
  assert.equal(ack.success, true, ack.error);
  assert.equal(lastState(world, 3, 'alarm'), 0);
  // Garage is in Monitor: ZoneMinder 1.38 would hang, so it is not asked.
  ack = await world.fake.sceneAction('force_alarm', { camera: idOf(world, 2), command: 'start' });
  assert.equal(ack.success, false);
  assert.match(ack.error, /does not analyse/);
  assert.equal(
    world.server.writes.filter((write) => write.id === 2).length,
    0,
    'nothing sent to ZoneMinder',
  );
});

test('scene action: the state of a monitor', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createAll(world);
  world.server.alarm.set(1, 2);
  const ack = await world.fake.sceneAction('get_status', { camera: idOf(world, 1) });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(ack.data.outputs, {
    online: true,
    alarm: true,
    enabled: true,
    mode: 'modect',
    events_today: 0,
  });
});

test('a viewer account: reading works, a change of mode says why it fails', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createAll(world);
  world.server.viewer = true;
  const ack = await world.fake.sceneAction('set_mode', { mode: 'record' });
  assert.equal(ack.success, false);
  assert.match(ack.error, /Insufficient privileges/);
  assert.doesNotMatch(ack.error, /LEAKED|token/);
});

test('an expired token: logged in again without a word', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createAll(world);
  world.server.expireTokens();
  await world.hub.refresh();
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
  world.server.expireTokens();
  const image = await world.hub.imageFor(idOf(world, 1));
  assert.match(image, /^image\/jpg;base64,/);
});

test('a wrong password, an account without API, a server down: the connection status', async (t) => {
  let world = await createWorld({ config: { ...DEFAULT_CONFIG, password: 'wrong' } });
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.match(world.fake.connectionStatus.message.en, /refuses the user name or password/);
  await world.app.stop();

  const server = new FakeZoneMinder();
  server.apiEnabled = false;
  world = await createWorld({ server });
  assert.match(world.fake.connectionStatus.message.fr, /API Enabled/);
  await world.app.stop();

  world = await createWorld();
  t.after(() => world.app.stop());
  await createAll(world);
  world.server.down = true;
  await world.hub.refresh();
  assert.match(world.fake.connectionStatus.message.en, /does not answer/);
  assert.equal(world.fake.transports.at(-1).transport, 'unreachable');
  world.server.down = false;
  await world.hub.refresh();
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
});

test('a ZoneMinder without login: no token sent', async (t) => {
  const server = new FakeZoneMinder({ auth: false });
  const world = await createWorld({ server, config: { url: '192.0.2.10', username: '' } });
  t.after(() => world.app.stop());
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
  assert.ok(server.requests.every((request) => !request.query.includes('token=')));
});

test('the "Check the connection" action lists the monitors', async (t) => {
  const world = await createWorld({ config: { ...DEFAULT_CONFIG, language: 'fr' } });
  t.after(() => world.app.stop());
  await createAll(world);
  await world.hub.refresh();
  await world.hub.refresh();
  const ack = await world.fake.action('check', {});
  assert.equal(ack.success, true, ack.error);
  assert.match(ack.data.message.fr, /ZoneMinder 1\.36\.4 répond à http:\/\/192\.0\.2\.10\/zm/);
  assert.match(ack.data.message.fr, /- Garage: pas d'images, Monitor/);
  assert.match(ack.data.message.en, /- Front door: receives images, Modect/);
});

test('a monitor removed from ZoneMinder leaves the discovery list', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  world.server.monitors.delete(2);
  await world.hub.refresh();
  assert.deepEqual(
    world.fake.discoveredDevices.map((device) => device.name),
    ['Front door', 'Porch'],
  );
});
