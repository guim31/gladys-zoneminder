// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `camera`.
//
// The Gladys camera box shows the image only. This widget adds what
// ZoneMinder knows: whether the monitor is in alarm, its mode, today's
// events, a button that starts (or cancels) a forced alarm, and one that
// brings a new image.
//
// Budget (8 components, 2 texts, 1 status, 4 buttons): a caption, the image,
// one status list, two buttons.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { deviceName, namesFor } from './devices.js';
import { WIDGET_KEY } from './hub.js';
import { ALARM_MODES } from './zoneminder/client.js';

export const ACTIONS = { START: 'alarm_start_1', CANCEL: 'alarm_cancel_1', REFRESH: 'refresh_1' };
// How long `get` waits for a first image before showing the caption alone.
const FIRST_IMAGE_WAIT_MS = 8000;

export const TEXT = {
  pick: {
    en: 'Choose a camera in the settings of this widget.',
    fr: 'Choisissez une caméra dans les réglages de ce widget.',
    de: 'Wähle in den Einstellungen dieses Widgets eine Kamera aus.',
    es: 'Elija una cámara en la configuración de este widget.',
  },
  unknown: {
    en: 'This monitor is no longer in ZoneMinder, or ZoneMinder does not answer.',
    fr: 'Ce moniteur n’est plus dans ZoneMinder, ou ZoneMinder ne répond pas.',
    de: 'Dieser Monitor ist nicht mehr in ZoneMinder, oder ZoneMinder antwortet nicht.',
    es: 'Este monitor ya no está en ZoneMinder, o ZoneMinder no responde.',
  },
  imageAt: { en: 'Image', fr: 'Image', de: 'Bild', es: 'Imagen' },
  noImage: {
    en: 'No image yet',
    fr: 'Pas encore d’image',
    de: 'Noch kein Bild',
    es: 'Aún no hay imagen',
  },
  offline: { en: 'no images', fr: 'pas d’images', de: 'keine Bilder', es: 'sin imágenes' },
  disabled: { en: 'capture off', fr: 'capture arrêtée', de: 'Aufnahme aus', es: 'captura apagada' },
  inAlarm: { en: 'In alarm', fr: 'En alarme', de: 'Alarm', es: 'En alarma' },
  quiet: { en: 'Quiet', fr: 'Calme', de: 'Ruhig', es: 'Tranquila' },
  start: {
    en: 'Start an alarm',
    fr: 'Déclencher l’alarme',
    de: 'Alarm auslösen',
    es: 'Activar la alarma',
  },
  cancel: {
    en: 'Cancel the alarm',
    fr: 'Annuler l’alarme',
    de: 'Alarm beenden',
    es: 'Cancelar la alarma',
  },
  refresh: { en: 'New image', fr: 'Nouvelle image', de: 'Neues Bild', es: 'Nueva imagen' },
  started: {
    en: 'Forced alarm started: ZoneMinder records an event',
    fr: 'Alarme forcée déclenchée : ZoneMinder enregistre un événement',
    de: 'Erzwungener Alarm ausgelöst: ZoneMinder zeichnet ein Ereignis auf',
    es: 'Alarma forzada activada: ZoneMinder graba un evento',
  },
  cancelled: {
    en: 'Forced alarm cancelled',
    fr: 'Alarme forcée annulée',
    de: 'Erzwungener Alarm beendet',
    es: 'Alarma forzada cancelada',
  },
  noAnalysis: {
    en: 'This monitor does not analyse its images: put it in Modect, Mocord or Nodect first.',
    fr: 'Ce moniteur n’analyse pas ses images : passez-le d’abord en Modect, Mocord ou Nodect.',
    de: 'Dieser Monitor analysiert seine Bilder nicht: Stelle ihn zuerst auf Modect, Mocord oder Nodect.',
    es: 'Este monitor no analiza sus imágenes: póngalo primero en Modect, Mocord o Nodect.',
  },
};

const t = (text, language) => text[language] ?? text.en;

export const imageKey = (monitor) => `mon-${monitor.id}-${monitor.imageSeq.toString(36)}`;

/** The short ZoneMinder name of a mode: `Modect`. */
const modeName = (mode) => (mode ? mode[0].toUpperCase() + mode.slice(1) : '-');

function message(text, language) {
  return {
    ttl_seconds: 60,
    components: [{ type: 'text', variant: 'body', text: t(text, language) }],
  };
}

function timeOf(at, language) {
  return new Intl.DateTimeFormat(language, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(at));
}

async function get(hub, { settings, language = 'en' }) {
  const monitor = settings?.camera ? hub.resolveDevice(settings.camera) : null;
  if (!monitor) {
    return message(settings?.camera ? TEXT.unknown : TEXT.pick, language);
  }
  if (!monitor.image && monitor.online !== false && hub.client && hub.server === 'ok') {
    // The first look at this camera: wait a little for an image.
    await Promise.race([
      hub.grab(monitor).catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, FIRST_IMAGE_WAIT_MS).unref?.()),
    ]);
  }
  const names = namesFor(language);
  const caption = [
    monitor.image
      ? `${t(TEXT.imageAt, language)} ${timeOf(monitor.image.at, language)}`
      : t(TEXT.noImage, language),
  ];
  if (!monitor.enabled) {
    caption.push(t(TEXT.disabled, language));
  } else if (monitor.online === false) {
    caption.push(t(TEXT.offline, language));
  }
  const components = [{ type: 'text', variant: 'caption', text: caption.join(' · ') }];
  if (monitor.image) {
    components.push({
      type: 'image',
      key: imageKey(monitor),
      alt: deviceName(monitor, language),
      fit: 'contain',
    });
  }
  components.push({
    type: 'status',
    items: [
      {
        label: names.alarm,
        icon: 'bell',
        value: t(monitor.alarm ? TEXT.inAlarm : TEXT.quiet, language),
        color: monitor.alarm ? WIDGET_COLORS.DANGER : WIDGET_COLORS.NEUTRAL,
      },
      { label: names.mode, icon: 'sliders', value: modeName(monitor.mode) },
      {
        label: names.events_today,
        icon: 'film',
        value: monitor.eventsToday ?? '-',
      },
    ],
  });
  if (monitor.alarm) {
    components.push({
      type: 'button',
      label: t(TEXT.cancel, language),
      icon: 'bell-off',
      style: 'secondary',
      action: { key: ACTIONS.CANCEL },
    });
  } else if (ALARM_MODES.includes(monitor.mode) && monitor.enabled) {
    components.push({
      type: 'button',
      label: t(TEXT.start, language),
      icon: 'bell',
      style: 'secondary',
      action: { key: ACTIONS.START },
    });
  }
  components.push({
    type: 'button',
    label: t(TEXT.refresh, language),
    icon: 'refresh-cw',
    style: 'secondary',
    action: { key: ACTIONS.REFRESH },
  });
  return {
    ttl_seconds: Math.min(Math.max(hub.config.snapshotSeconds, 10), 300),
    components,
  };
}

async function action(hub, { actionKey, settings }) {
  if (!settings?.camera) {
    throw new Error(TEXT.pick.en);
  }
  const monitor = hub.require(settings.camera);
  if (actionKey === ACTIONS.REFRESH) {
    await hub.grab(monitor);
    return {};
  }
  if (actionKey === ACTIONS.START || actionKey === ACTIONS.CANCEL) {
    const on = actionKey === ACTIONS.START;
    try {
      await hub.forceAlarm(monitor, on);
    } catch (err) {
      if (err.kind === 'mode') {
        return { message: TEXT.noAnalysis };
      }
      throw err;
    }
    return { message: on ? TEXT.started : TEXT.cancelled };
  }
  throw new Error(`Unknown action ${actionKey}`);
}

/** The bytes behind an image key of the widget (raw base64). */
export async function widgetImage(hub, key) {
  const match = /^mon-(\d+)-[0-9a-z]+$/.exec(String(key));
  const monitor = match ? hub.monitors.get(Number(match[1])) : null;
  if (!monitor?.image) {
    throw new Error(`Unknown image ${key}`);
  }
  // Already fit for Gladys (150 KB), well under the 300 KB of a widget image.
  return monitor.image.jpeg.toString('base64');
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};
