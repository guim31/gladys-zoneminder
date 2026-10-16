// The `camera` widget: content inside the core's vocabulary and budget, the
// image served, the forced alarm and refresh buttons.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent, validateWidgetImage } from '@gladysassistant/integration-sdk';
import { ACTIONS } from '../src/widgets.js';
import { createAll, createWorld } from './helpers/world.js';

const get = (world, camera, language = 'en') =>
  world.fake.widgetGet('camera', { settings: { camera }, language });

test('the widget shows the image, alarm, mode, events and two buttons', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createAll(world);
  const [device] = world.fake.discoveredDevices;
  world.server.alarm.set(1, 2);
  await world.hub.pollAll();
  for (const language of ['en', 'fr', 'de', 'es']) {
    const ack = await get(world, device.external_id, language);
    assert.equal(ack.success, true, ack.error);
    const { content } = ack.data;
    assert.deepEqual(validateWidgetContent(content), [], language);
    assert.deepEqual(
      content.components.map((component) => component.type),
      ['text', 'image', 'status', 'button', 'button'],
    );
    assert.equal(content.components[3].action.key, ACTIONS.CANCEL);
    if (language === 'fr') {
      assert.deepEqual(
        content.components[2].items.map((item) => item.value),
        ['En alarme', 'Modect', 0],
      );
      assert.equal(content.components[3].label, 'Annuler l’alarme');
    }
    const image = await world.fake.widgetGetImage(content.components[1].key);
    assert.equal(image.success, true, image.error);
    assert.deepEqual(validateWidgetImage(image.data.image), []);
  }
});

test('a monitor that does not analyse: no alarm button, the refresh one only', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createAll(world);
  const garage = world.fake.discoveredDevices[1];
  const ack = await get(world, garage.external_id);
  const buttons = ack.data.content.components.filter((component) => component.type === 'button');
  assert.deepEqual(
    buttons.map((button) => button.action.key),
    [ACTIONS.REFRESH],
  );
});

test('the alarm button starts a forced alarm in ZoneMinder', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createAll(world);
  const porch = world.fake.discoveredDevices[2];
  const ack = await world.fake.widgetAction(
    'camera',
    ACTIONS.START,
    {},
    { settings: { camera: porch.external_id } },
  );
  assert.equal(ack.success, true, ack.error);
  assert.match(ack.data.message.fr, /Alarme forcée déclenchée/);
  assert.deepEqual(world.server.writes, [{ id: 3, command: 'on' }]);
  const refresh = await world.fake.widgetAction(
    'camera',
    ACTIONS.REFRESH,
    {},
    { settings: { camera: porch.external_id } },
  );
  assert.equal(refresh.success, true, refresh.error);
});

test('without a camera, or with one ZoneMinder no longer has: a sentence', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  let ack = await world.fake.widgetGet('camera', { settings: {}, language: 'de' });
  assert.match(ack.data.content.components[0].text, /Wähle/);
  ack = await get(world, 'ext:x:monitor:9');
  assert.match(ack.data.content.components[0].text, /no longer in ZoneMinder/);
});
