// -----------------------------------------------------------------------------
// The ZoneMinder hub: one server, its monitors, and everything Gladys sees of
// them.
//
// Two timers run in the container (the devices are published with
// should_poll: false, see src/devices.js):
//   - the alarm check, every `alarm_interval` seconds: the alarm state of each
//     monitor added in Gladys, and the events started since the last check.
//     A new event fires "New event" with its cause and score, and sends the
//     image of the moment; an image also goes every `snapshot_interval`;
//   - the monitor check, every minute: the monitor list (names, modes,
//     enabled, whether frames come in), today's event counts, and whether the
//     server answers at all.
//
// States go through publishChangedStates (only what changed, a heartbeat
// every 12 h so a quiet value never looks stale).
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { connectionKey } from './config.js';
import { FEATURE_KEYS, buildDevice, deviceIds, deviceName, featureKeyOf } from './devices.js';
import {
  ALARM_MODES,
  ALARM_STATES,
  MODES,
  ZoneMinderClient,
  ZoneMinderError,
  eventKind,
} from './zoneminder/client.js';
import { CONNECTION_TEXT } from './texts.js';

const logger = createLogger({ name: 'zoneminder' });

export const WIDGET_KEY = 'camera';
export const TRIGGERS = { EVENT: 'event_started', OFFLINE: 'monitor_offline' };

export const IMAGE_PREFIX = 'image/jpg;base64,';
// The core keeps camera images of 150 KB at most, once written as a data URI.
export const MAX_JPEG_BYTES = Math.floor((150 * 1024 - IMAGE_PREFIX.length) / 4) * 3;
// Scales (percent) asked to ZoneMinder when a frame is too heavy.
export const FIT_SCALES = [50, 25];

export const DEFAULT_TIMINGS = {
  monitorsMs: 60 * 1000,
  // A monitor is said offline after this many monitor checks in a row
  // without frames: a change of mode restarts its capture for seconds.
  offlineAfter: 2,
  // After a change written by the integration, missing frames are not
  // counted this long.
  restartGraceMs: 30 * 1000,
  // 12 images a minute per camera at most (the core's bound).
  minImageSpacingMs: 5000,
  heartbeatMs: 12 * 60 * 60 * 1000,
  concurrency: 4,
  // New events read at once, at most (the rest at the next check).
  eventBatch: 50,
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// How old the last image may be to stand in for a fresh one.
const STALE_IMAGE_MS = 5 * 60 * 1000;

export const toDataUri = (jpeg) => `${IMAGE_PREFIX}${jpeg.toString('base64')}`;

const pad = (value) => String(value).padStart(2, '0');

/** Local midnight as ZoneMinder writes dates (`2026-10-16 00:00:00`). */
export function localMidnight(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} 00:00:00`;
}

export class ZoneMinderHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake)
   * @param {Function} [options.fetch] fetch for the ZoneMinder client (tests)
   * @param {boolean} [options.timers] run the periodic timers
   * @param {object} [options.timings] overrides of DEFAULT_TIMINGS
   * @param {Function} [options.now] the clock (tests)
   */
  constructor({ gladys, fetch, timers = true, timings = {}, now = () => new Date() }) {
    this.gladys = gladys;
    this.fetch = fetch;
    this.useTimers = timers;
    this.timings = { ...DEFAULT_TIMINGS, ...timings };
    this.now = now;
    this.config = null;
    this.client = null;
    this.clientKey = null;
    this.monitors = new Map();
    // null (not tried yet), 'ok', 'auth', 'apiDisabled', 'unreachable', 'error', 'noUrl'
    this.server = null;
    this.lastEventId = null;
    this.publishedDevicesKey = null;
    this.pending = new Set();
    this.timers = [];
    this.stopped = false;
  }

  // --- Lifecycle ---------------------------------------------------------------

  async start(config) {
    this.applyConfig(config);
    logger.info(
      this.client
        ? `Starting with the ZoneMinder server ${this.client.origin}`
        : 'No valid ZoneMinder address in the configuration',
    );
    await this.refresh();
    this.startTimers();
  }

  /** Gladys came back: re-send what it may have lost. */
  async resync(config) {
    this.applyConfig(config);
    this.publishedDevicesKey = null;
    await this.refresh();
    for (const device of this.gladys.devices ?? []) {
      this.gladys.forgetPublishedStates(device.external_id);
    }
    await this.publishAllStates();
    await this.publishTransports();
  }

  async reconfigure(config) {
    const language = this.config?.language;
    this.applyConfig(config);
    if (language !== config.language) {
      this.publishedDevicesKey = null;
    }
    await this.refresh();
    this.startTimers();
  }

  applyConfig(config) {
    this.config = config;
    const key = connectionKey(config);
    if (key === this.clientKey) {
      return;
    }
    this.clientKey = key;
    this.generation = (this.generation ?? 0) + 1;
    this.monitors.clear();
    this.lastEventId = null;
    // The monitors already added in Gladys, known before ZoneMinder answers:
    // they can be said unreachable when it never does.
    for (const device of this.gladys.devices ?? []) {
      const param = (device.params ?? []).find((item) => item.name === 'ZONEMINDER_MONITOR_ID');
      const id = Number(param?.value);
      if (Number.isInteger(id)) {
        this.monitors.set(id, { ...this.newMonitor(id), name: String(device.name ?? '') });
      }
    }
    this.server = null;
    this.publishedDevicesKey = null;
    this.client = config.validUrl
      ? new ZoneMinderClient({
          url: config.url,
          username: config.username,
          password: config.password,
          fetch: this.fetch,
        })
      : null;
  }

  startTimers() {
    this.clearTimers();
    if (!this.useTimers || this.stopped) {
      return;
    }
    this.timers.push(
      setInterval(() => this.track(this.pollAll()), this.config.alarmSeconds * 1000),
      setInterval(() => this.track(this.refresh()), this.timings.monitorsMs),
    );
    for (const timer of this.timers) {
      timer.unref?.();
    }
  }

  clearTimers() {
    for (const timer of this.timers) {
      clearInterval(timer);
    }
    this.timers = [];
  }

  /** Keep a background task, so stop() and the tests can wait for it. */
  track(promise) {
    const task = Promise.resolve(promise).catch((err) => logger.debug(err.message));
    this.pending.add(task);
    task.finally(() => this.pending.delete(task));
    return task;
  }

  async idle() {
    while (this.pending.size > 0) {
      await Promise.all([...this.pending]);
    }
  }

  async stop() {
    this.stopped = true;
    this.clearTimers();
    await this.idle();
  }

  // --- Server and monitor list -----------------------------------------------------

  /** Read the monitor list and today's counts; publish what changed. */
  refresh() {
    // A refresh started before a change of configuration speaks of the old
    // server: chain a new one rather than share its result.
    if (!this.refreshing || this.refreshing.generation !== this.generation) {
      const previous = this.refreshing ?? Promise.resolve();
      const generation = this.generation;
      const run = previous
        .catch(() => {})
        .then(() => this.doRefresh(generation))
        .finally(() => {
          if (this.refreshing === run) {
            this.refreshing = null;
          }
        });
      run.generation = generation;
      this.refreshing = run;
    }
    return this.refreshing;
  }

  async doRefresh(generation = this.generation) {
    if (!this.client) {
      await this.setServer('noUrl');
      return;
    }
    let list;
    try {
      list = await this.client.listMonitors();
    } catch (err) {
      if (generation === this.generation) {
        await this.serverFailed(err);
      }
      return;
    }
    if (generation !== this.generation) {
      return;
    }
    const seen = new Set();
    for (const item of list) {
      seen.add(item.id);
      const monitor = this.monitors.get(item.id) ?? this.newMonitor(item.id);
      this.monitors.set(item.id, monitor);
      this.applyMonitor(monitor, item);
    }
    for (const id of [...this.monitors.keys()]) {
      if (!seen.has(id)) {
        logger.info(`Monitor ${id} is no longer in ZoneMinder`);
        this.monitors.delete(id);
      }
    }
    await this.setServer('ok');
    await this.publishDevices();
    await this.countToday();
    for (const monitor of this.monitors.values()) {
      await this.checkOnline(monitor);
    }
    await this.publishAllStates();
  }

  newMonitor(id) {
    return {
      id,
      name: '',
      enabled: true,
      mode: null,
      split: false,
      connected: null,
      online: null,
      misses: 0,
      alarm: null,
      eventsToday: null,
      image: null,
      imageSeq: 0,
      lastPublishAt: 0,
      polling: null,
    };
  }

  applyMonitor(monitor, item) {
    monitor.name = item.name;
    monitor.enabled = item.enabled;
    monitor.mode = item.mode;
    monitor.split = item.split;
    monitor.connected = item.connected;
    if (!monitor.enabled && monitor.alarm) {
      monitor.alarm = false;
    }
  }

  async serverFailed(err) {
    const state =
      err.kind === 'auth' || err.kind === 'apiDisabled'
        ? err.kind
        : err.kind === 'network'
          ? 'unreachable'
          : 'error';
    if (state !== this.server) {
      const line = `ZoneMinder ${this.client.label}: ${err.message}`;
      if (state === 'unreachable' && this.server === 'ok') {
        logger.warn(line);
      } else {
        logger.error(line);
      }
    } else {
      logger.debug(err.message);
    }
    await this.setServer(state);
  }

  async setServer(state) {
    const previous = this.server;
    this.server = state;
    if (state === 'ok' && previous && previous !== 'ok') {
      logger.info(`ZoneMinder ${this.client.label} answers again`);
    }
    if (state === previous) {
      return;
    }
    if (state !== 'ok') {
      // Nothing can be read any more: no stale alarm, no "local" badge.
      for (const monitor of this.monitors.values()) {
        monitor.online = false;
        monitor.alarm = monitor.alarm === null ? null : false;
        await this.publishStates(monitor);
      }
      await this.publishTransports();
      this.requestWidgetRefresh();
    }
    try {
      if (state === 'ok') {
        await this.gladys.setConnectionStatus(true);
      } else {
        await this.gladys.setConnectionStatus(false, CONNECTION_TEXT[state]);
      }
    } catch (err) {
      logger.debug(`Cannot send the connection status: ${err.message}`);
    }
  }

  /** Today's events of every monitor added in Gladys (one request each). */
  async countToday() {
    const since = localMidnight(this.now());
    for (const monitor of this.monitors.values()) {
      if (!this.isCreated(monitor)) {
        continue;
      }
      try {
        monitor.eventsToday = await this.client.countEvents(monitor.id, since);
      } catch (err) {
        logger.debug(`Cannot count the events of monitor ${monitor.id}: ${err.message}`);
      }
    }
  }

  // --- Devices -------------------------------------------------------------------

  ids(monitor) {
    return deviceIds(this.gladys, monitor.id);
  }

  async publishDevices() {
    const devices = [...this.monitors.values()].map((monitor) =>
      buildDevice(this.gladys, monitor, this.config.language),
    );
    // Republished when a monitor appears, goes or is renamed: an upsert on
    // the devices already added, a new entry in the Discovery tab otherwise.
    const key = JSON.stringify(devices.map((device) => [device.external_id, device.name]));
    if (key === this.publishedDevicesKey) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.publishedDevicesKey = key;
      if (this.devicesFailing) {
        this.devicesFailing = false;
        logger.info('The monitors are published to Gladys again');
      }
    } catch (err) {
      // Tried again at the next reading of the list.
      if (!this.devicesFailing) {
        this.devicesFailing = true;
        logger.warn(`Cannot publish the monitors to Gladys: ${err.message}`);
      }
    }
  }

  isCreated(monitor) {
    const id = this.ids(monitor).device;
    return (this.gladys.devices ?? []).some((device) => device.external_id === id);
  }

  /** The monitor behind a Gladys device external id, or null. */
  resolveDevice(externalId) {
    for (const monitor of this.monitors.values()) {
      if (this.ids(monitor).device === externalId) {
        return monitor;
      }
    }
    return null;
  }

  require(externalId) {
    const monitor = this.resolveDevice(externalId);
    if (!monitor) {
      throw new Error(`Unknown ZoneMinder monitor ${externalId}: check the integration`);
    }
    return monitor;
  }

  // --- States --------------------------------------------------------------------

  statesOf(monitor) {
    const ids = this.ids(monitor);
    const states = [
      {
        device_feature_external_id: ids.feature(FEATURE_KEYS.ENABLED),
        state: monitor.enabled ? 1 : 0,
      },
    ];
    if (monitor.mode) {
      states.push({
        device_feature_external_id: ids.feature(FEATURE_KEYS.MODE),
        text: monitor.mode,
      });
    }
    if (monitor.alarm !== null) {
      states.push({
        device_feature_external_id: ids.feature(FEATURE_KEYS.ALARM),
        state: monitor.alarm ? 1 : 0,
      });
    }
    if (monitor.eventsToday !== null) {
      states.push({
        device_feature_external_id: ids.feature(FEATURE_KEYS.EVENTS_TODAY),
        state: monitor.eventsToday,
      });
    }
    return states;
  }

  async publishStates(monitor) {
    if (!this.isCreated(monitor)) {
      return;
    }
    try {
      // Only what changed; a value that never changes again every 12 h.
      await this.gladys.publishChangedStates(this.statesOf(monitor), {
        heartbeat: this.timings.heartbeatMs,
      });
      if (this.statesFailing) {
        this.statesFailing = false;
        logger.info('States are published to Gladys again');
      }
    } catch (err) {
      if (this.statesFailing) {
        logger.debug(`Cannot publish the states of monitor ${monitor.id}: ${err.message}`);
      } else {
        this.statesFailing = true;
        logger.warn(`Cannot publish the states of monitor ${monitor.id}: ${err.message}`);
      }
    }
  }

  async publishAllStates() {
    for (const monitor of this.monitors.values()) {
      await this.publishStates(monitor);
    }
  }

  async publishTransports(monitors = [...this.monitors.values()]) {
    const entries = monitors
      .filter((monitor) => monitor.online !== null && this.isCreated(monitor))
      .map((monitor) => ({
        external_id: this.ids(monitor).device,
        transport: monitor.online ? 'local' : 'unreachable',
      }));
    if (entries.length > 0) {
      await this.gladys.publishTransports(entries).catch((err) => logger.debug(err.message));
    }
  }

  /**
   * The user added a device: the states sent before were dropped by Gladys,
   * and so was the transport badge. Send them again, with an image.
   */
  async onDeviceCreated(device) {
    const monitor = this.resolveDevice(device?.external_id);
    if (!monitor) {
      return;
    }
    this.gladys.forgetPublishedStates(device.external_id);
    if (this.server === 'ok') {
      try {
        monitor.eventsToday = await this.client.countEvents(monitor.id, localMidnight(this.now()));
      } catch (err) {
        logger.debug(`Cannot count the events of monitor ${monitor.id}: ${err.message}`);
      }
    }
    await this.publishStates(monitor);
    monitor.lastPublishAt = 0;
    await this.poll(monitor);
    if (monitor.enabled && monitor.online !== false) {
      await this.publishImage(monitor);
    }
    await this.publishTransports([monitor]);
    this.requestWidgetRefresh();
  }

  requestWidgetRefresh() {
    try {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    } catch (err) {
      logger.debug(`Widget refresh refused: ${err.message}`);
    }
  }

  // --- Online / offline ------------------------------------------------------------

  async checkOnline(monitor) {
    if (!monitor.enabled) {
      // Turned off in ZoneMinder: no frame expected, no "offline" alarm.
      await this.setOnline(monitor, false, { quiet: true });
      return;
    }
    if (monitor.connected) {
      monitor.misses = 0;
      await this.setOnline(monitor, true);
      return;
    }
    if (Date.now() < (this.restartUntil ?? 0)) {
      return;
    }
    monitor.misses += 1;
    if (monitor.misses >= this.timings.offlineAfter || monitor.online === null) {
      await this.setOnline(monitor, false);
    }
  }

  async setOnline(monitor, online, { quiet = false } = {}) {
    if (monitor.online === online) {
      return;
    }
    const was = monitor.online;
    monitor.online = online;
    const name = deviceName(monitor, this.config.language);
    if (online && was === false) {
      logger.info(`Monitor ${monitor.id} (${name}) receives images again`);
    } else if (!online && was === true && !quiet) {
      logger.info(`Monitor ${monitor.id} (${name}) receives no images any more`);
    }
    await this.publishTransports([monitor]);
    this.requestWidgetRefresh();
    if (!online && was === true && !quiet && this.isCreated(monitor)) {
      this.track(
        this.gladys.publishSceneEvent(TRIGGERS.OFFLINE, {
          camera: this.ids(monitor).device,
          camera_name: name,
        }),
      );
    }
  }

  // --- Alarm check -----------------------------------------------------------------

  /** One alarm check: every monitor added in Gladys, then the new events. */
  async pollAll() {
    if (!this.client || this.server !== 'ok') {
      return;
    }
    const monitors = [...this.monitors.values()].filter(
      (monitor) => monitor.enabled && !monitor.polling && this.isCreated(monitor),
    );
    for (let at = 0; at < monitors.length; at += this.timings.concurrency) {
      await Promise.all(
        monitors.slice(at, at + this.timings.concurrency).map((monitor) => this.poll(monitor)),
      );
    }
    await this.checkEvents();
    for (const monitor of monitors) {
      if (
        monitor.online !== false &&
        Date.now() - monitor.lastPublishAt >= this.config.snapshotSeconds * 1000
      ) {
        await this.publishImage(monitor);
      }
    }
  }

  poll(monitor) {
    if (!monitor.polling) {
      monitor.polling = this.readAlarm(monitor).finally(() => {
        monitor.polling = null;
      });
    }
    return monitor.polling;
  }

  async readAlarm(monitor) {
    if (!this.client || !monitor.enabled || this.stopped) {
      return;
    }
    let state;
    try {
      state = await this.client.alarmState(monitor.id);
    } catch (err) {
      if (err.kind === 'auth' || err.kind === 'network') {
        await this.serverFailed(err);
      } else {
        logger.debug(`Monitor ${monitor.id}: ${err.message}`);
      }
      return;
    }
    // Alarm, then alert (the frames after it): one alarm, not two.
    const alarm = state === ALARM_STATES.ALARM || state === ALARM_STATES.ALERT;
    const rising = alarm && monitor.alarm === false;
    if (alarm !== monitor.alarm) {
      monitor.alarm = alarm;
      await this.publishStates(monitor);
      this.requestWidgetRefresh();
    }
    if (rising) {
      await this.publishImage(monitor, { wait: true });
    }
  }

  /** The events started since the last check: triggers, images, counts. */
  async checkEvents() {
    try {
      if (this.lastEventId === null) {
        // The first check: what happened before is not news.
        this.lastEventId = await this.client.lastEventId();
        return;
      }
      const events = await this.client.eventsAfter(this.lastEventId, this.timings.eventBatch);
      const today = localMidnight(this.now()).slice(0, 10);
      const touched = new Set();
      const imaged = new Set();
      for (const event of events) {
        this.lastEventId = Math.max(this.lastEventId, event.id);
        const monitor = this.monitors.get(event.monitorId);
        if (!monitor || !this.isCreated(monitor)) {
          continue;
        }
        if (event.start.startsWith(today) && monitor.eventsToday !== null) {
          monitor.eventsToday += 1;
        }
        touched.add(monitor);
        if (!imaged.has(monitor)) {
          imaged.add(monitor);
          // The image of the moment first: a "Send a camera image" right
          // after the trigger sends it.
          await this.publishImage(monitor, { wait: true });
        }
        this.track(
          this.gladys.publishSceneEvent(TRIGGERS.EVENT, {
            camera: this.ids(monitor).device,
            camera_name: deviceName(monitor, this.config.language),
            kind: eventKind(event.cause),
            cause: (event.cause || event.notes || '-').slice(0, 100),
            score: event.score,
            event_id: event.id,
          }),
        );
      }
      for (const monitor of touched) {
        await this.publishStates(monitor);
      }
      if (touched.size > 0) {
        this.requestWidgetRefresh();
      }
    } catch (err) {
      if (err.kind === 'auth' || err.kind === 'network') {
        await this.serverFailed(err);
      } else {
        logger.debug(`Cannot read the new events: ${err.message}`);
      }
    }
  }

  // --- Images --------------------------------------------------------------------

  /** A JPEG Gladys keeps (≤ MAX_JPEG_BYTES), at full scale or smaller. */
  async grab(monitor) {
    const scales = monitor.fitScale ? [monitor.fitScale] : [100, ...FIT_SCALES];
    for (const scale of scales) {
      const jpeg = await this.client.image(monitor.id, { scale });
      if (jpeg.length <= MAX_JPEG_BYTES) {
        monitor.fitScale = scale === 100 ? null : scale;
        monitor.image = { jpeg, at: Date.now() };
        monitor.imageSeq += 1;
        return jpeg;
      }
    }
    monitor.fitScale = null;
    throw new ZoneMinderError(`The frames of monitor ${monitor.id} stay over 150 KB`);
  }

  /** Send a fresh frame to Gladys, at most one every 5 s per camera. */
  async publishImage(monitor, { wait = false } = {}) {
    if (!this.isCreated(monitor) || !this.client) {
      return false;
    }
    const left = monitor.lastPublishAt + this.timings.minImageSpacingMs - Date.now();
    if (left > 0) {
      if (!wait) {
        return false;
      }
      await sleep(left);
    }
    monitor.lastPublishAt = Date.now();
    try {
      const jpeg = await this.grab(monitor);
      await this.gladys.publishCameraImage(this.ids(monitor).device, toDataUri(jpeg));
      return true;
    } catch (err) {
      // 404: the camera is turned off in Gladys, or not added; 429: too many.
      logger.debug(`Image of monitor ${monitor.id} not sent: ${err.message}`);
      return false;
    }
  }

  /** A fresh image for Gladys (dashboard, "show me the camera"): data URI. */
  async imageFor(externalId) {
    const monitor = this.require(externalId);
    try {
      return toDataUri(await this.grab(monitor));
    } catch (err) {
      logger.debug(`No fresh image of monitor ${monitor.id}: ${err.message}`);
      if (!monitor.image || Date.now() - monitor.image.at > STALE_IMAGE_MS) {
        throw new Error(`Monitor ${monitor.id} has no image right now`, { cause: err });
      }
      return toDataUri(monitor.image.jpeg);
    }
  }

  // --- Commands ------------------------------------------------------------------

  /** The mode list of the dashboard, or a scene's "Control a device". */
  async setValue(device, feature, value) {
    const monitor = this.require(device?.external_id);
    if (featureKeyOf(feature?.external_id) !== FEATURE_KEYS.MODE) {
      throw new Error(`The feature ${feature?.external_id} cannot be set`);
    }
    await this.setMode([monitor], String(value));
  }

  /** Change the mode of monitors, then read them back from ZoneMinder. */
  async setMode(monitors, mode) {
    if (!MODES.includes(mode)) {
      throw new Error(`Unknown mode "${mode}": ${MODES.join(', ')}`);
    }
    const changed = monitors.filter((monitor) => monitor.mode !== mode);
    // A change restarts the capture of the monitor: not an outage.
    this.restartUntil = Date.now() + this.timings.restartGraceMs;
    for (const monitor of changed) {
      await this.client.setMode(monitor, mode);
      monitor.mode = mode;
      if (!ALARM_MODES.includes(mode) && monitor.alarm) {
        monitor.alarm = false;
      }
    }
    this.restartUntil = Date.now() + this.timings.restartGraceMs;
    if (changed.length > 0) {
      logger.info(`Mode ${mode} set on monitor ${changed.map((monitor) => monitor.id).join(', ')}`);
    }
    for (const monitor of monitors) {
      await this.publishStates(monitor);
    }
    this.requestWidgetRefresh();
    return changed.length;
  }

  /** Start or cancel a forced alarm (it lasts until cancelled). */
  async forceAlarm(monitor, on) {
    if (on && !ALARM_MODES.includes(monitor.mode)) {
      // 1.36 refuses, 1.38 holds the request until it times out.
      throw new ZoneMinderError(`Monitor ${monitor.id} does not analyse its images`, {
        kind: 'mode',
      });
    }
    await this.client.forceAlarm(monitor.id, on);
    logger.info(`Forced alarm ${on ? 'started' : 'cancelled'} on monitor ${monitor.id}`);
    await this.poll(monitor);
    this.requestWidgetRefresh();
  }

  // --- Report --------------------------------------------------------------------

  summary() {
    if (this.server !== 'ok') {
      return { problem: this.server ?? 'unreachable' };
    }
    return {
      url: this.client.label,
      version: this.client.version,
      monitors: [...this.monitors.values()].map((monitor) => ({
        name: deviceName(monitor, this.config.language),
        enabled: monitor.enabled,
        online: monitor.online,
        mode: monitor.mode,
      })),
    };
  }
}
