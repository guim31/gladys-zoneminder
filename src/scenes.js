// -----------------------------------------------------------------------------
// Scene actions (manifest `scene_actions`, Gladys 5.1+).
//
// Gladys can already set the mode of one camera from a scene ("Control a
// device"); what these actions add: the mode of EVERY monitor at once (the
// "alarm armed" scene: everything in Modect), a forced alarm started or
// cancelled (ZoneMinder records it as an event, e.g. when a door opens), and
// the state of a monitor as values the next actions can test.
// -----------------------------------------------------------------------------

import { MODES } from './zoneminder/client.js';

export const ALARM_COMMANDS = { start: true, cancel: false };

function monitorOf(hub, fields) {
  if (!fields?.camera) {
    throw new Error('Choose a camera');
  }
  return hub.require(fields.camera);
}

async function setMode(hub, { fields }) {
  if (!MODES.includes(fields?.mode)) {
    throw new Error(`Unknown mode "${fields?.mode}": ${MODES.join(', ')}`);
  }
  // "Every camera": those added in Gladys and capturing; a monitor turned off
  // in ZoneMinder, or left out of Gladys, is not the user's to change here.
  const monitors = fields?.camera
    ? [hub.require(fields.camera)]
    : [...hub.monitors.values()].filter((monitor) => monitor.enabled && hub.isCreated(monitor));
  if (monitors.length === 0) {
    throw new Error('No ZoneMinder camera added in Gladys');
  }
  const changed = await hub.setMode(monitors, fields.mode);
  return { cameras: changed };
}

async function forceAlarm(hub, { fields }) {
  const on = ALARM_COMMANDS[fields?.command];
  if (on === undefined) {
    throw new Error(`Unknown command "${fields?.command}": start or cancel`);
  }
  await hub.forceAlarm(monitorOf(hub, fields), on);
}

async function getStatus(hub, { fields }) {
  const monitor = monitorOf(hub, fields);
  // A fresh read: the action is often the first step of a scene.
  await hub.poll(monitor);
  return {
    online: monitor.online === true,
    alarm: monitor.alarm === true,
    enabled: monitor.enabled === true,
    mode: monitor.mode ?? '',
    events_today: monitor.eventsToday ?? 0,
  };
}

export const SCENE_ACTIONS = {
  set_mode: setMode,
  force_alarm: forceAlarm,
  get_status: getStatus,
};
