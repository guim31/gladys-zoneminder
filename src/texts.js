// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status and the "Check the connection" report. Four languages,
// the four of the Gladys interface; German says "du", Spanish "usted".
// test/i18n.test.js checks every table.
// -----------------------------------------------------------------------------

import { modeLabel } from './devices.js';

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

// Shown by Gladys under the integration name when it is not connected.
export const CONNECTION_TEXT = {
  noUrl: {
    en: 'Enter the address of ZoneMinder (e.g. 192.168.1.20 or http://nas.lan/zm) in the configuration.',
    fr: "Saisissez l'adresse de ZoneMinder (ex. 192.168.1.20 ou http://nas.lan/zm) dans la configuration.",
    de: 'Gib die Adresse von ZoneMinder (z. B. 192.168.1.20 oder http://nas.lan/zm) in der Konfiguration ein.',
    es: 'Introduzca la dirección de ZoneMinder (p. ej. 192.168.1.20 o http://nas.lan/zm) en la configuración.',
  },
  auth: {
    en: 'ZoneMinder refuses the user name or password.',
    fr: "ZoneMinder refuse l'identifiant ou le mot de passe.",
    de: 'ZoneMinder lehnt Benutzername oder Passwort ab.',
    es: 'ZoneMinder rechaza el usuario o la contraseña.',
  },
  apiDisabled: {
    en: 'This ZoneMinder user may not use the API: tick "API enabled" in Options → Users.',
    fr: "Cet utilisateur ZoneMinder n'a pas accès à l'API : cochez « API Enabled » dans Options → Users.",
    de: 'Dieser ZoneMinder-Benutzer darf die API nicht nutzen: Aktiviere „API Enabled“ unter Options → Users.',
    es: 'Este usuario de ZoneMinder no puede usar la API: marque «API Enabled» en Options → Users.',
  },
  unreachable: {
    en: 'ZoneMinder does not answer at this address.',
    fr: 'ZoneMinder ne répond pas à cette adresse.',
    de: 'ZoneMinder antwortet unter dieser Adresse nicht.',
    es: 'ZoneMinder no responde en esta dirección.',
  },
  error: {
    en: 'ZoneMinder answers, but not as expected: check the address (with /zm?) and the logs.',
    fr: "ZoneMinder répond, mais pas comme prévu : vérifiez l'adresse (avec /zm ?) et les logs.",
    de: 'ZoneMinder antwortet, aber nicht wie erwartet: Prüfe die Adresse (mit /zm?) und die Protokolle.',
    es: 'ZoneMinder responde, pero no como se esperaba: compruebe la dirección (¿con /zm?) y los registros.',
  },
};

const MAX_LISTED = 10;

// The pieces of the "Check the connection" report, one table per language.
export const CHECK_TEXT = {
  en: {
    connected: (url, version, count) =>
      `ZoneMinder ${version ?? ''} answers at ${url}: ${count} monitor(s).`,
    online: 'receives images',
    offline: 'no images',
    disabled: 'capture off in ZoneMinder',
  },
  fr: {
    connected: (url, version, count) =>
      `ZoneMinder ${version ?? ''} répond à ${url} : ${count} moniteur(s).`,
    online: 'reçoit des images',
    offline: "pas d'images",
    disabled: 'capture désactivée dans ZoneMinder',
  },
  de: {
    connected: (url, version, count) =>
      `ZoneMinder ${version ?? ''} antwortet unter ${url}: ${count} Monitor(e).`,
    online: 'empfängt Bilder',
    offline: 'keine Bilder',
    disabled: 'Aufnahme in ZoneMinder aus',
  },
  es: {
    connected: (url, version, count) =>
      `ZoneMinder ${version ?? ''} responde en ${url}: ${count} monitor(es).`,
    online: 'recibe imágenes',
    offline: 'sin imágenes',
    disabled: 'captura desactivada en ZoneMinder',
  },
};

/** The report of the "Check the connection" action, in the four languages. */
export function checkMessage(summary) {
  if (summary.problem) {
    return CONNECTION_TEXT[summary.problem];
  }
  const message = {};
  for (const [language, text] of Object.entries(CHECK_TEXT)) {
    const lines = [
      text.connected(summary.url, summary.version, summary.monitors.length).replace(/ {2}/, ' '),
    ];
    for (const monitor of summary.monitors.slice(0, MAX_LISTED)) {
      const flags = [
        !monitor.enabled
          ? text.disabled
          : monitor.online === false
            ? text.offline
            : monitor.online === true
              ? text.online
              : null,
        monitor.mode ? modeLabel(monitor.mode, language) : null,
      ].filter(Boolean);
      lines.push(`- ${monitor.name}: ${flags.join(', ')}`);
    }
    if (summary.monitors.length > MAX_LISTED) {
      lines.push('…');
    }
    message[language] = lines.join('\n');
  }
  return message;
}
