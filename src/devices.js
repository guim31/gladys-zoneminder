// -----------------------------------------------------------------------------
// What a ZoneMinder monitor becomes in Gladys: one camera device, with
//   - its image (`camera/image`), pushed by the integration;
//   - `alarm`: the monitor is in alarm right now (`motion-sensor/binary`,
//     1 = alarm), motion or forced alarm alike;
//   - `mode`: the function of the monitor (`text/select`, values `monitor`,
//     `modect`, `record`, `mocord`, `nodect`), which the dashboard can change:
//     a deliberate choice in a list, never a toggle a voice assistant flips;
//   - `capture-on`: the monitor captures (`input/binary`), read only: turning
//     a surveillance camera off stays a decision made in ZoneMinder. Never
//     `camera/enabled`: since Gladys 5.2 that is the user's privacy mode, and
//     at 0 the core refuses the camera's images. Up to 1.0.x it was published
//     under the key `enabled` (LEGACY_ENABLED_KEY);
//   - `events-today`: events started since midnight (`counter-sensor/integer`).
// Whether frames come in is the device's transport badge (`local` /
// `unreachable`) and the "Monitor offline" scene trigger, not a feature.
//
// Feature keys are forever: they are part of the external ids.
// -----------------------------------------------------------------------------

import { MODES } from './zoneminder/client.js';

export const DEVICE_TYPE = 'monitor';

export const FEATURE_KEYS = {
  IMAGE: 'image',
  ALARM: 'alarm',
  MODE: 'mode',
  CAPTURE_ON: 'capture-on',
  EVENTS_TODAY: 'events-today',
};

// The `camera/enabled` feature of the 1.0.x devices, still in Gladys until the
// user clicks "Update" in the Discovery tab. Never reused for anything else.
export const LEGACY_ENABLED_KEY = 'enabled';

// Feature names, frozen when the user adds the device.
export const NAMES = {
  en: {
    camera: 'Camera',
    image: 'Image',
    alarm: 'Alarm',
    mode: 'Mode',
    capture_on: 'Capture on',
    events_today: 'Events today',
  },
  fr: {
    camera: 'Caméra',
    image: 'Image',
    alarm: 'Alarme',
    mode: 'Mode',
    capture_on: 'Capture active',
    events_today: "Événements aujourd'hui",
  },
  de: {
    camera: 'Kamera',
    image: 'Bild',
    alarm: 'Alarm',
    mode: 'Modus',
    capture_on: 'Aufnahme aktiv',
    events_today: 'Ereignisse heute',
  },
  es: {
    camera: 'Cámara',
    image: 'Imagen',
    alarm: 'Alarma',
    mode: 'Modo',
    capture_on: 'Captura activa',
    events_today: 'Eventos de hoy',
  },
};

// The modes as ZoneMinder names them, with what they do.
export const MODE_LABELS = {
  en: {
    monitor: 'Monitor (watch only)',
    modect: 'Modect (record on motion)',
    record: 'Record (always)',
    mocord: 'Mocord (always, motion marked)',
    nodect: 'Nodect (external trigger)',
  },
  fr: {
    monitor: 'Monitor (visualisation seule)',
    modect: 'Modect (enregistre sur mouvement)',
    record: 'Record (enregistre en continu)',
    mocord: 'Mocord (continu, mouvement marqué)',
    nodect: 'Nodect (déclenchement externe)',
  },
  de: {
    monitor: 'Monitor (nur ansehen)',
    modect: 'Modect (Aufnahme bei Bewegung)',
    record: 'Record (Daueraufnahme)',
    mocord: 'Mocord (Dauer, Bewegung markiert)',
    nodect: 'Nodect (externer Auslöser)',
  },
  es: {
    monitor: 'Monitor (solo visualizar)',
    modect: 'Modect (graba con movimiento)',
    record: 'Record (graba siempre)',
    mocord: 'Mocord (siempre, movimiento marcado)',
    nodect: 'Nodect (disparo externo)',
  },
};

export const namesFor = (language) => NAMES[language] ?? NAMES.en;
export const modeLabel = (mode, language) => (MODE_LABELS[language] ?? MODE_LABELS.en)[mode];

/** The ids of one monitor: its ZoneMinder id, unique on the server. */
export function deviceIds(gladys, monitorId) {
  return gladys.externalIds(DEVICE_TYPE, String(monitorId));
}

/** The feature key behind a feature external id (`…:mode`). */
export function featureKeyOf(externalId) {
  const key = String(externalId ?? '')
    .split(':')
    .pop();
  return Object.values(FEATURE_KEYS).includes(key) ? key : null;
}

export function featureSpecs(language) {
  const names = namesFor(language);
  return [
    {
      key: FEATURE_KEYS.IMAGE,
      category: 'camera',
      type: 'image',
      name: names.image,
      min: 0,
      max: 0,
      read_only: true,
      has_feedback: false,
      keep_history: false,
    },
    {
      key: FEATURE_KEYS.ALARM,
      category: 'motion-sensor',
      type: 'binary',
      name: names.alarm,
      min: 0,
      max: 1,
      read_only: true,
      has_feedback: true,
      keep_history: true,
    },
    {
      key: FEATURE_KEYS.MODE,
      category: 'text',
      type: 'select',
      name: names.mode,
      min: 0,
      max: 0,
      read_only: false,
      has_feedback: true,
      keep_history: false,
      supported_options: MODES.map((value, index) => ({
        value,
        label: modeLabel(value, language),
        sort_order: index,
      })),
    },
    {
      key: FEATURE_KEYS.CAPTURE_ON,
      category: 'input',
      type: 'binary',
      name: names.capture_on,
      min: 0,
      max: 1,
      read_only: true,
      has_feedback: true,
      keep_history: true,
    },
    {
      key: FEATURE_KEYS.EVENTS_TODAY,
      category: 'counter-sensor',
      type: 'integer',
      name: names.events_today,
      min: 0,
      max: 100000,
      read_only: true,
      has_feedback: false,
      keep_history: true,
    },
  ];
}

/** The monitor name in ZoneMinder, or "Camera 3". */
export function deviceName(monitor, language) {
  const name = String(monitor.name ?? '').trim();
  return (name || `${namesFor(language).camera} ${monitor.id}`).slice(0, 80);
}

export function buildDevice(gladys, monitor, language) {
  const ids = deviceIds(gladys, monitor.id);
  return {
    name: deviceName(monitor, language),
    external_id: ids.device,
    model: 'ZoneMinder',
    // The container reads the monitors at its own pace (alarm interval): the
    // Gladys scheduler has no use here.
    should_poll: false,
    params: [{ name: 'ZONEMINDER_MONITOR_ID', value: String(monitor.id) }],
    features: featureSpecs(language).map(({ key, ...spec }) => ({
      ...spec,
      external_id: ids.feature(key),
    })),
  };
}
