// -----------------------------------------------------------------------------
// The integration: the App Box at the address of the configuration, read
// every poll interval in UDP (status and settings), its Gladys device and
// states, the transport badge, the "Test the connection" button, and the
// commands. index.js only wires the SDK handlers to it (src/handlers.js).
//
// Reads follow the rules learnt on the previous modules:
//   - never sooner than the interval after the last one: not for the test
//     button, a Discovery scan, a reconnection to Gladys, a configuration
//     saved unchanged, nor a restart of the container (the time of the last
//     read is kept in /data, written BEFORE the read, at most once a
//     minute); a reconnection during a read joins nothing and reads nothing;
//   - an answer that arrives for an old configuration (generation) publishes
//     nothing and sets no status; a read begun before a command left is not
//     applied (it may show the state before the command).
//
// Commands:
//   - TURN ON is sensitive: refused unless "Allow heating from Gladys" is on,
//     checked on arrival and again right before every datagram; decided on a
//     fresh read of the status and the settings (never on the state in
//     memory), refused when a value it needs is missing; before it, the
//     timer of the App Box is set to the "Session duration" (never "no
//     timer") and a setpoint above the "Highest setpoint" is lowered to it,
//     both read back; the power on leaves within 3.5 s of the click or is
//     refused unsent; one at a time; confirmed only by a read showing the
//     power on, else "sent, without confirmation";
//   - the SETPOINT is behind the same option, never above the "Highest
//     setpoint" (checked again right before the datagram), confirmed by a
//     read of the settings;
//   - TURN OFF protects: never held back, outside any queue, on its own
//     socket: not by the option, a command in flight, a read in progress, an
//     unreachable App Box, nor before the first read after a restart (the
//     address comes from the configuration). It is sent again while the App
//     Box is silent (4 datagrams at most), cancels a turn on not sent yet, is
//     sent once more when a turn on already sent settles, and is reaffirmed
//     (3 times at most) by the reads of the next two minutes if the App Box
//     heats again (the guard is kept in /data);
//   - LAMP and FAN: plain sets, one at a time each, confirmed by a read;
//   - the ack never waits for a publication to Gladys.
// -----------------------------------------------------------------------------

import { performance } from 'node:perf_hooks';
import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig, usable } from './config.js';
import { FEATURES, MINUTE, PRESSED, SECOND, TEMPERATURE, TIMINGS } from './constants.js';
import { COMMAND_ROLES, appBoxIds, buildDevice, parseFeatureId, statesOf } from './devices.js';
import { ERRORS, T, age, join, reasonText, statusText, word } from './i18n.js';
import { ToloClient } from './tolo/client.js';
import { ERROR_KINDS } from './tolo/udp.js';
import { PORT } from './tolo/protocol.js';
import { StatePublisher } from './publisher.js';
import { fileStore, normalizeMemory } from './store.js';

const freshBox = () => ({
  /** The last status and settings read (src/tolo/protocol.js), else undefined. */
  status: undefined,
  settings: undefined,
  /** When a read last succeeded (monotonic clock). */
  readAt: -Infinity,
  /** undefined: not read yet since the start; false: the last read failed. */
  online: undefined,
  failures: 0,
  wait: undefined,
  error: undefined,
  timer: undefined,
  running: undefined,
  followUps: new Set(),
});

/** A refusal: its message is shown by Gladys. `sent` counts the datagrams that left. */
class Refusal extends Error {}

/** The reason of a failed exchange, for a status or a refusal (no secret exists here). */
/** The reason of a failed exchange, in both languages (a refusal keeps its message). */
const reasonOf = (err) =>
  err instanceof Refusal ? { en: err.message, fr: err.message } : reasonText(err);

/** Whether a datagram of this exchange may have left. */
const mayHaveLeft = (err) => err?.kind === ERROR_KINDS.NO_ANSWER || (err?.sent ?? 0) > 0;

export class ToloApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'tolo' }),
    transport,
    port = PORT,
    now = Date.now,
    mono = () => performance.now(),
    timers = globalThis,
    store = fileStore(),
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.mono = mono;
    this.timers = timers;
    this.store = store;
    this.client = new ToloClient({ transport, now: mono, port });
    this.publisher = new StatePublisher({ gladys, logger, now, timers });
    this.config = normalizeConfig();
    this.memory = normalizeMemory(null, now());
    this.box = freshBox();
    this.generation = 0;
    this.started = false;
    /** The time of the last read sent (wall clock; /data keeps it within a minute). */
    this.lastAttemptAt = -Infinity;
    this.lastStatus = undefined;
    this.published = undefined;
    this.badge = undefined;
    /** Monotonic times: the last command datagram, the last power on datagram. */
    this.lastSentAt = -Infinity;
    this.lastStartAt = -Infinity;
    /** Until then, a power on sent without confirmation may still land. */
    this.unconfirmedStartUntil = -Infinity;
    /** The turn on in progress: { seq, sentAt, answered, promise }. */
    this.heatEntry = undefined;
    /** Counts the turn offs: a turn on that sees it change gives way. */
    this.protectSeq = 0;
    /** The guard of a turn off: { host, sentAt, until, reasserts, sticky } (monotonic). */
    this.stopGuard = undefined;
    /** Turn off exchanges in flight (every turn on waits for them). */
    this.stopsInFlight = 0;
    /** The non-protective commands in progress, by role. */
    this.busy = new Set();
    /**
     * A session turned on from Gladys: until its end, every status read checks
     * that a timer of at most the session duration runs. { until, enforcing }.
     */
    this.sessionWatch = undefined;
    /** A note for the status after the integration turned a session off itself. */
    this.alert = undefined;
  }

  // --- Lifecycle -------------------------------------------------------------

  /**
   * `fresh`: started for a new address while running (a read may go at
   * once); otherwise (container start) the first read waits for the interval
   * after the last read kept in /data.
   */
  async start(raw = {}, { fresh = false } = {}) {
    this.stop();
    await this.box.running;
    const generation = this.generation;
    this.config = normalizeConfig(raw);
    this.memory = normalizeMemory(await this.store.load().catch(() => null), this.now());
    if (generation !== this.generation) {
      return;
    }
    if (this.memory.lastAttemptAt !== null) {
      // Written at most once a minute: the read may have left up to a minute later.
      this.lastAttemptAt = Math.max(
        this.lastAttemptAt,
        Math.min(this.now(), this.memory.lastAttemptAt + TIMINGS.attemptWriteEvery),
      );
    }
    this.restoreStopGuard();
    this.restoreWatch();
    this.box = freshBox();
    this.published = undefined;
    this.badge = undefined;
    this.lastStatus = undefined;
    this.publisher.start();
    if (!usable(this.config)) {
      await this.publishAll();
      return;
    }
    await this.setStatus(false, this.status()[1]);
    if (generation !== this.generation) {
      return;
    }
    const wait = fresh ? 0 : this.firstWait();
    if (wait > 0) {
      this.schedule(wait);
      if (this.stopGuardActive() && wait > TIMINGS.guardRead) {
        // A turn off guard restored from /data: one protective read soon,
        // whatever the interval, then the usual follow-ups.
        this.guardRead();
      }
      await this.publishAll();
      return;
    }
    await this.tick();
  }

  /** The read of a guard restored from /data, 5 s after the start. */
  guardRead() {
    const generation = this.generation;
    const b = this.box;
    const handle = this.timers.setTimeout(() => {
      b.followUps.delete(handle);
      if (generation === this.generation) {
        this.tick()
          .then(() => this.followUp())
          .catch(() => this.logger.error('TOLO refresh failed'));
      }
    }, TIMINGS.guardRead);
    b.followUps.add(handle);
  }

  /** The wait before the first read after a container start, from the time kept in /data. */
  firstWait() {
    return Math.min(this.interval, Math.max(0, this.due - this.now()));
  }

  stop() {
    this.generation += 1;
    this.clearTimer();
    if (this.sessionWatch?.timer) {
      this.timers.clearTimeout(this.sessionWatch.timer);
      this.sessionWatch.timer = undefined;
    }
    for (const handle of this.box.followUps) {
      this.timers.clearTimeout(handle);
    }
    this.box.followUps.clear();
    this.publisher.stop();
  }

  clearTimer() {
    if (this.box.timer) {
      this.timers.clearTimeout(this.box.timer);
      this.box.timer = undefined;
    }
  }

  /** Only a new address restarts (an interval only reschedules). */
  needsRestart(raw) {
    const next = normalizeConfig(raw);
    return next.host !== this.config.host || next.badHost !== this.config.badHost;
  }

  /**
   * Connected to Gladys. The first time, start; after a reconnection, resend
   * what Gladys keeps in memory only (status, Discovery list, badge) and the
   * last states, without reading the App Box. Guards stay.
   */
  async connected(raw = {}) {
    if (!this.started) {
      this.started = true;
      await this.start(raw);
      return;
    }
    if (this.needsRestart(raw)) {
      await this.start(raw, { fresh: true });
      return;
    }
    const previous = this.config;
    this.config = normalizeConfig(raw);
    this.published = undefined;
    this.badge = undefined;
    this.lastStatus = undefined;
    this.rescheduleOnNewInterval(previous);
    await this.publishAll();
  }

  /** A new interval: the next read follows it, counted from the last read. */
  rescheduleOnNewInterval(previous) {
    const b = this.box;
    if (
      this.config.pollInterval !== previous.pollInterval &&
      usable(this.config) &&
      !b.running &&
      b.online !== false &&
      b.timer
    ) {
      this.schedule();
    }
  }

  async configUpdated(raw = {}) {
    if (this.needsRestart(raw)) {
      await this.start(raw, { fresh: true });
      return;
    }
    const previous = this.config;
    this.config = normalizeConfig(raw);
    this.rescheduleOnNewInterval(previous);
    if (this.config.allowHeating !== previous.allowHeating) {
      this.logger.info(`TOLO heating from Gladys ${this.config.allowHeating ? 'allowed' : 'off'}`);
    }
    if (this.config.language !== previous.language) {
      this.published = undefined;
    }
    await this.publishAll();
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  async saveMemory() {
    await this.store
      .save(this.memory)
      .catch((err) => this.logger.warn(`Saving the state to /data failed: ${err.message}`));
  }

  // --- Polling ---------------------------------------------------------------

  get interval() {
    return this.config.pollInterval * SECOND;
  }

  /** The earliest time the next polling read may go: the interval after the last one. */
  get due() {
    return this.lastAttemptAt + this.interval;
  }

  /** The next read: after its backoff, else the interval; never sooner than the interval. */
  schedule(delay) {
    const b = this.box;
    this.clearTimer();
    if (!usable(this.config)) {
      return;
    }
    let wait = delay ?? (b.online === false ? b.wait : this.interval);
    // Capped at the interval: a clock set back never stops the reads.
    wait = Math.max(wait ?? this.interval, Math.min(this.interval, this.due - this.now()), 0);
    const generation = this.generation;
    b.timer = this.timers.setTimeout(() => {
      b.timer = undefined;
      if (generation === this.generation) {
        this.tick().catch(() => this.logger.error('TOLO refresh failed'));
      }
    }, wait);
  }

  /** One read at a time: a tick during a read joins it. */
  tick() {
    const b = this.box;
    if (!b.running) {
      b.running = this.run().finally(() => {
        b.running = undefined;
      });
    }
    return b.running;
  }

  /**
   * Keeps the time of this read; when the write of the minute is due, in
   * /data BEFORE the read (a container stopped during the read keeps it).
   */
  async noteAttempt() {
    const now = this.now();
    this.lastAttemptAt = now;
    const stored = this.memory.lastAttemptAt;
    if (stored === null || now - stored >= TIMINGS.attemptWriteEvery) {
      this.memory.lastAttemptAt = now;
      await this.saveMemory();
    }
  }

  /** The status and the settings, each on its own socket, at once. */
  readBoth(host, options) {
    return Promise.allSettled([
      this.client.status(host, options),
      this.client.settings(host, options),
    ]);
  }

  async run() {
    const generation = this.generation;
    const host = this.config.host;
    if (!host) {
      return;
    }
    let delay;
    await this.noteAttempt();
    if (generation !== this.generation) {
      return;
    }
    const startedAt = this.mono();
    const [status, settings] = await this.readBoth(host, {
      attempts: TIMINGS.readAttempts,
      attemptTimeout: TIMINGS.readAttemptTimeout,
    });
    if (generation !== this.generation) {
      return;
    }
    if (status.status === 'fulfilled') {
      if (startedAt <= this.lastSentAt) {
        // Begun before a command left: it may show the state before it.
        this.logger.debug('TOLO: read begun before a command, not applied');
        this.box.online = true;
        this.box.failures = 0;
      } else {
        this.applyRead(status.value, settings.value);
      }
    } else {
      delay = this.failed(status.reason);
    }
    await this.publishAll();
    if (generation === this.generation) {
      this.schedule(delay);
    }
  }

  /**
   * A read (polling, fresh read of a command, or the read back after one).
   * Settings missing (that read failed): the last ones stay.
   */
  applyRead(status, settings, { fromCommand = false } = {}) {
    const b = this.box;
    b.online = true;
    b.failures = 0;
    b.wait = undefined;
    b.error = undefined;
    if (status) {
      b.readAt = this.mono();
      b.status = status;
      this.observe(status, { fromCommand });
    }
    if (settings) {
      b.settings = settings;
    }
  }

  /** A failed read: the delay before the next one. */
  failed(err) {
    const b = this.box;
    const wait = Math.max(
      this.interval,
      TIMINGS.backoff[Math.min(b.failures, TIMINGS.backoff.length - 1)],
    );
    b.failures += 1;
    b.online = false;
    b.wait = wait;
    b.error = reasonOf(err);
    this.logger.warn(`TOLO: ${b.error.en}; next try in ${Math.round(wait / 1000)} s`);
    return wait;
  }

  /** `[connected, message]` of the configuration screen. */
  status() {
    const b = this.box;
    if (!this.config.host) {
      return [false, this.config.badHost ? T.badHost : T.noHost];
    }
    if (b.online === false) {
      return [false, T.unreachable(b.error ?? reasonText(undefined), age(b.wait ?? this.interval))];
    }
    if (b.online === undefined || !b.status) {
      return [false, b.timer ? T.waiting(age(Math.max(0, this.due - this.now()))) : T.connecting];
    }
    const connected = T.connected(T.summary(b.status));
    return [true, this.alert ? join(connected, this.alert) : connected];
  }

  async updateStatus() {
    const [connected, message] = this.status();
    await this.setStatus(connected, message);
  }

  // --- Gladys ----------------------------------------------------------------

  get ids() {
    return appBoxIds(this.gladys);
  }

  async publishAll() {
    const generation = this.generation;
    await this.publishDevices();
    if (generation !== this.generation) {
      return;
    }
    this.queueStates();
    await this.flush();
    if (generation !== this.generation) {
      return;
    }
    await this.publishBadge();
    if (generation !== this.generation) {
      return;
    }
    await this.updateStatus();
  }

  async flush() {
    await this.publisher
      .flush()
      .catch((err) => this.logger.warn(`Sending to Gladys failed: ${err.message}`));
  }

  /** The device, once the App Box answered at the configured address. */
  async publishDevices() {
    if (!this.box.status || !this.config.host) {
      return;
    }
    const devices = [buildDevice(this.gladys, { language: this.config.language })];
    const json = JSON.stringify(devices);
    if (json === this.published) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.published = json;
    } catch (err) {
      this.logger.warn(`Publishing the discovered devices failed: ${err.message}`);
    }
  }

  createdFeatures() {
    return new Set(
      (this.gladys.devices ?? []).flatMap((d) => (d.features ?? []).map((f) => f.external_id)),
    );
  }

  queueStates(created = this.createdFeatures()) {
    const b = this.box;
    if (!b.status || !this.config.host) {
      return;
    }
    for (const { role, ...value } of statesOf(b.status, b.settings, {
      language: this.config.language,
    })) {
      const id = this.ids.feature(role);
      if (created.has(id)) {
        this.publisher.push(id, value);
      }
    }
  }

  async publishBadge() {
    const device = (this.gladys.devices ?? []).find((d) => d?.external_id === this.ids.device);
    if (!device) {
      return;
    }
    const reachable = Boolean(this.config.host) && this.box.online !== false;
    const entries = [
      {
        external_id: device.external_id,
        transport: reachable ? DEVICE_TRANSPORTS.LOCAL : DEVICE_TRANSPORTS.UNREACHABLE,
      },
    ];
    const json = JSON.stringify(entries);
    if (json === this.badge) {
      return;
    }
    try {
      await this.gladys.publishTransports(entries);
      this.badge = json;
    } catch (err) {
      this.logger.warn(`Transport badge failed: ${err.message}`);
    }
  }

  /** A device was created (or updated): send its last values at once. */
  async deviceCreated(device) {
    this.badge = undefined;
    const created = this.createdFeatures();
    for (const f of device?.features ?? []) {
      created.add(f.external_id);
    }
    this.queueStates(created);
    await this.flush();
    await this.publishBadge();
  }

  async deviceDeleted(device) {
    this.badge = undefined;
    if (typeof device?.external_id === 'string') {
      this.publisher.forget(device.external_id);
    }
  }

  /** The Discovery tab asks for a scan: the device of the last read, sent again (no read). */
  async scan() {
    this.published = undefined;
    await this.publishDevices();
  }

  // --- Configuration button --------------------------------------------------

  /** A read now, unless the last one is more recent than the interval (then its result). */
  async testConnection() {
    if (!usable(this.config)) {
      return this.status()[1];
    }
    const b = this.box;
    const current = () => JSON.parse(this.lastStatus ?? '[false,null]')[1] ?? this.status()[1];
    if (b.running) {
      await b.running;
      return current();
    }
    if (this.now() < this.due) {
      const last = this.status()[1];
      const waited = T.waiting(age(this.due - this.now()));
      return Number.isFinite(this.lastAttemptAt) && b.online !== undefined
        ? join(join(last, T.lastRead(age(this.now() - this.lastAttemptAt))), waited)
        : join(last, waited);
    }
    this.clearTimer();
    await this.tick();
    return current();
  }

  // --- Commands --------------------------------------------------------------

  get lang() {
    return this.config.language === 'en' ? 'en' : 'fr';
  }

  refusal(text) {
    return new Refusal(word(text, this.config.language));
  }

  /** A setpoint from Gladys: a whole number of °C (45 or "45"), else undefined. */
  static setpointOf(value) {
    let n;
    if (typeof value === 'number') {
      n = value;
    } else if (typeof value === 'string' && /^\s*\d{1,3}(?:\.0+)?\s*$/.test(value)) {
      n = Number(value);
    }
    return Number.isInteger(n) ? n : undefined;
  }

  /** 0 or 1 (a number, or the text "0" / "1"), else undefined. */
  static binaryOf(value) {
    if (value === 0 || value === '0') {
      return false;
    }
    if (value === 1 || value === '1') {
      return true;
    }
    return undefined;
  }

  /**
   * The address a turn off goes to: the configuration, else (not loaded
   * yet, right after a start) the SDK's cache of it, else the address of a
   * turn off guard kept in /data.
   */
  stopHost() {
    return (
      this.config.host ??
      normalizeConfig(this.gladys.config ?? {}).host ??
      this.memory.stopGuard?.host
    );
  }

  async setValue(_device, feature, value) {
    // The deadlines count from the arrival of the command, before any wait.
    const received = this.mono();
    const role = parseFeatureId(this.gladys, feature?.external_id);
    if (!role || !COMMAND_ROLES.includes(role)) {
      throw this.refusal(ERRORS.readOnly);
    }
    if (role === FEATURES.HEAT_OFF) {
      // Any value presses it (0, true, "on"...): a scene, an MCP client or an
      // "everything off" may send anything, and turning off is never dangerous.
      const host = this.stopHost();
      if (!host) {
        throw this.refusal(ERRORS.noConfig);
      }
      return this.turnOff(received, host);
    }
    if (!this.config.host) {
      throw this.refusal(ERRORS.noConfig);
    }
    if (role === FEATURES.HEAT_ON) {
      // Strictly 1: null, '', true, 0 or "on" never press "Turn on".
      if (value !== PRESSED && value !== String(PRESSED)) {
        throw this.refusal(ERRORS.badButton);
      }
      return this.heat(received);
    }
    if (role === FEATURES.TARGET) {
      const temperature = ToloApp.setpointOf(value);
      if (
        temperature === undefined ||
        temperature < TEMPERATURE.min ||
        temperature > this.config.maxTemperature
      ) {
        throw this.refusal(ERRORS.badSetpoint(TEMPERATURE.min, this.config.maxTemperature));
      }
      return this.setpoint(received, temperature);
    }
    const on = ToloApp.binaryOf(value);
    if (on === undefined) {
      throw this.refusal(ERRORS.badBinary);
    }
    return this.plainSet(role, on, received);
  }

  /** The options of an exchange of a command: 2 datagrams, bounded by the deadlines. */
  commandOptions(sendBy, answerBy, beforeSend) {
    return {
      attempts: TIMINGS.commandAttempts,
      attemptTimeout: TIMINGS.commandAttemptTimeout,
      sendBy,
      answerBy,
      beforeSend,
    };
  }

  /**
   * The checks of a heating command (turn on, setpoint), on the latest
   * configuration: on arrival, after the fresh read, and right before every
   * datagram. For turning on, a turn off in flight or not confirmed yet (its
   * guard) refuses, and so does a turn off arrived meanwhile.
   */
  checkHeat(generation, host, entry) {
    if (!this.config.allowHeating) {
      throw this.refusal(ERRORS.heatingDisabled);
    }
    if (generation !== this.generation || host !== this.config.host) {
      throw this.refusal(ERRORS.configChanged);
    }
    if (!entry) {
      return;
    }
    if (entry.seq !== this.protectSeq) {
      throw this.refusal(ERRORS.stopMeanwhile);
    }
    if (this.stopsInFlight > 0 || this.stopGuardActive()) {
      throw this.refusal(ERRORS.stopPending);
    }
  }

  /** Turn on: one at a time. */
  async heat(received) {
    const generation = this.generation;
    const host = this.config.host;
    const probe = { seq: this.protectSeq };
    this.checkHeat(generation, host, probe);
    if (this.heatEntry) {
      throw this.refusal(ERRORS.busy);
    }
    const entry = { seq: this.protectSeq, sentAt: undefined, answered: false, promise: undefined };
    this.heatEntry = entry;
    entry.promise = this.sendHeat(host, received, generation, entry);
    try {
      return await entry.promise;
    } finally {
      entry.answered = true;
      if (this.heatEntry === entry) {
        this.heatEntry = undefined;
      }
    }
  }

  /** The read back of a command, shown in the background (never for an old configuration). */
  show(generation, status, settings) {
    if (generation !== this.generation) {
      return;
    }
    this.applyRead(status, settings, { fromCommand: true });
    this.publishAll().catch((err) => this.logger.warn(`Publishing failed: ${err.message}`));
  }

  /** A timer that bounds a session of `minutes` just started: 1 to `minutes` minutes left. */
  static timerBounds(status, minutes) {
    const left = status.powerTimer;
    return Number.isInteger(left) && left >= 1 && left <= minutes;
  }

  async sendHeat(host, received, generation, entry) {
    const b = this.box;
    // Already on, as a read of less than 10 s shows: nothing to send (a scene
    // pressing in a loop never floods the App Box). Deciding to SEND always
    // takes a fresh read.
    if (b.status?.powerOn === true && this.mono() - b.readAt < TIMINGS.recentRead) {
      this.checkHeat(generation, host, entry);
      return undefined;
    }
    const at = (ms) => received + ms;
    const [status, settings] = await this.readBoth(
      host,
      this.commandOptions(
        at(TIMINGS.heatReadBy - TIMINGS.commandAttemptTimeout),
        at(TIMINGS.heatReadBy),
      ),
    );
    if (status.status !== 'fulfilled' || settings.status !== 'fulfilled') {
      const err = status.status === 'rejected' ? status.reason : settings.reason;
      throw this.refusal(ERRORS.unknownState(reasonOf(err)));
    }
    this.checkHeat(generation, host, entry);
    // Decided on the fresh read only, never on the state in memory.
    const fresh = status.value;
    if (fresh.powerOn === undefined) {
      throw this.refusal(ERRORS.missing);
    }
    if (fresh.powerOn) {
      // Already on, as read: nothing sent.
      this.show(generation, fresh, settings.value);
      return undefined;
    }
    await this.prepare(host, received, generation, settings.value);
    // The checks again: right now, then right before every datagram.
    const sendBy = at(TIMINGS.commandSendBy);
    const lastChecks = () => {
      this.checkHeat(generation, host, entry);
      if (this.startMayLand) {
        throw this.refusal(ERRORS.inProgress);
      }
      if (this.mono() > sendBy) {
        throw this.refusal(ERRORS.tooSlow);
      }
    };
    lastChecks();
    let accepted;
    try {
      accepted = await this.client.set(
        host,
        'power',
        true,
        this.commandOptions(sendBy, at(TIMINGS.commandAnswerBy), () => {
          lastChecks();
          const t = this.mono();
          this.lastSentAt = t;
          this.lastStartAt = t;
          if (entry.sentAt === undefined) {
            entry.sentAt = t;
            this.watchSession(host);
          }
          this.logger.info(`TOLO: turn on (timer ${this.config.sessionMinutes} min)`);
        }),
      );
    } catch (err) {
      if (!mayHaveLeft(err)) {
        // Refused by the last checks, or nothing left.
        if (err instanceof Refusal) {
          throw err;
        }
        throw this.refusal(ERRORS.notSent(reasonOf(err)));
      }
      // A datagram left: it may have reached the App Box.
      this.logger.warn(`TOLO: turn on without answer (${reasonOf(err).en})`);
      this.unconfirmed();
      this.followUp();
      throw this.refusal(ERRORS.sentUnconfirmed(reasonOf(err)));
    }
    // Answered, accepted or not (the meaning of the answer byte comes from
    // tololib's simulator, never seen on a real App Box): the read decides.
    this.unconfirmed();
    const after = await this.readBack(host, 'status', at(TIMINGS.commandAnswerBy));
    this.followUp();
    if (after === undefined) {
      throw this.refusal(
        ERRORS.sentUnconfirmed(accepted ? ERRORS.noReadBack : ERRORS.answerRefused),
      );
    }
    this.show(generation, after);
    if (after.powerOn !== true) {
      if (!accepted && after.powerOn === false) {
        // Refused, and read off: nothing to guard nor to watch.
        this.unconfirmedStartUntil = -Infinity;
        this.clearWatch();
        throw this.refusal(ERRORS.refused);
      }
      throw this.refusal(ERRORS.sentUnconfirmed(ERRORS.readBack(statusText(after))));
    }
    if (!ToloApp.timerBounds(after, this.config.sessionMinutes)) {
      // On, without the timer asked: set it again in the background, else turn off.
      if (this.sessionWatch) {
        this.enforceTimer(this.sessionWatch, generation);
      }
      throw this.refusal(ERRORS.timerUnconfirmed(ERRORS.timerRead(after.powerTimer)));
    }
    if (entry.seq !== this.protectSeq) {
      throw this.refusal(ERRORS.stopAfterStart);
    }
    this.alert = undefined;
    if (!accepted) {
      throw this.refusal(ERRORS.refusedButReads(statusText(after)));
    }
    return undefined;
  }

  /**
   * Before a turn on: the timer of the App Box set to the session duration,
   * and a setpoint above the highest one lowered to it, both read back.
   * Neither heats: unless the read back shows both right, the turn on is
   * refused, "heating not sent".
   */
  async prepare(host, received, generation, settings) {
    const at = (ms) => received + ms;
    const options = this.commandOptions(
      at(TIMINGS.heatPrepareBy - TIMINGS.commandAttemptTimeout),
      at(TIMINGS.heatPrepareBy),
      () => {
        this.lastSentAt = this.mono();
      },
    );
    // The timer is always written (the session never relies on a timer set
    // earlier); the setpoint only when the fresh read shows it above the cap.
    const writes = [this.client.set(host, 'timer', this.config.sessionMinutes, options)];
    const target = settings.targetTemperature;
    if (target === undefined || target > this.config.maxTemperature) {
      writes.push(this.client.set(host, 'target', this.config.maxTemperature, options));
    }
    const results = await Promise.allSettled(writes);
    const lost = results.find((r) => r.status === 'rejected' && !mayHaveLeft(r.reason));
    if (lost) {
      throw this.refusal(ERRORS.prepareFailed(reasonOf(lost.reason)));
    }
    // Answered, refused or silent: the read back decides.
    const check = await this.readBack(host, 'settings', at(TIMINGS.heatCheckBy));
    if (check === undefined) {
      throw this.refusal(ERRORS.prepareFailed(ERRORS.noReadBack));
    }
    this.show(generation, undefined, check);
    if (
      check.powerTimer !== this.config.sessionMinutes ||
      check.targetTemperature === undefined ||
      check.targetTemperature > this.config.maxTemperature
    ) {
      throw this.refusal(
        ERRORS.prepareFailed(
          ERRORS.readBack({
            en: `${ERRORS.timerRead(check.powerTimer).en}, ${check.targetTemperature ?? '?'} °C`,
            fr: `${ERRORS.timerRead(check.powerTimer).fr}, ${check.targetTemperature ?? '?'} °C`,
          }),
        ),
      );
    }
  }

  /** One read after a command, by `answerBy`: the status or the settings, else undefined. */
  async readBack(host, what, answerBy) {
    try {
      return await this.client[what](
        host,
        this.commandOptions(answerBy - TIMINGS.commandAttemptTimeout / 2, answerBy),
      );
    } catch {
      return undefined;
    }
  }

  /** A turn on that may land later: its guard. */
  unconfirmed() {
    this.unconfirmedStartUntil = this.mono() + TIMINGS.guard;
  }

  /** A turn on may still land: in flight (sent, not answered), or sent without confirmation. */
  get startMayLand() {
    return (
      (this.heatEntry?.sentAt !== undefined && !this.heatEntry.answered) ||
      this.mono() < this.unconfirmedStartUntil
    );
  }

  // --- Session timer -------------------------------------------------------------

  /**
   * A power on left from Gladys: its session is held to its duration until
   * it is seen off. Kept in /data (wall-clock end) and given a dedicated
   * read at its planned end + margin.
   */
  watchSession(host) {
    const minutes = this.config.sessionMinutes;
    const startedAt = this.mono();
    this.setWatch({ host, minutes, startedAt, end: startedAt + minutes * MINUTE });
  }

  /** Installs a session watch (new or restored), persists it, schedules its end read. */
  setWatch({ host, minutes, startedAt, end }) {
    this.clearWatch({ persist: false });
    const w = { host, minutes, startedAt, end, enforcing: false, timer: undefined };
    this.sessionWatch = w;
    this.persistWatch();
    const generation = this.generation;
    const wait = Math.max(TIMINGS.guardRead, end + TIMINGS.sessionWatchMargin - this.mono());
    w.timer = this.timers.setTimeout(() => {
      w.timer = undefined;
      if (generation === this.generation && this.sessionWatch === w) {
        this.endRead(w, generation).catch((err) =>
          this.logger.warn(`TOLO: end read of the session failed (${err.message})`),
        );
      }
    }, wait);
  }

  clearWatch({ persist = true } = {}) {
    const w = this.sessionWatch;
    if (w?.timer) {
      this.timers.clearTimeout(w.timer);
    }
    this.sessionWatch = undefined;
    if (persist && w) {
      this.persistWatch();
    }
  }

  /** The watch into /data (wall clock), in the background. */
  persistWatch() {
    const w = this.sessionWatch;
    this.memory.session = w
      ? { host: w.host, minutes: w.minutes, endAt: this.now() + (w.end - this.mono()) }
      : null;
    this.saveMemory().catch(() => {});
  }

  /** The watch kept in /data for the configured address, back in memory (end read rescheduled). */
  restoreWatch() {
    const kept = this.memory.session;
    if (!kept || kept.host !== this.config.host) {
      this.clearWatch({ persist: false });
      return;
    }
    const end = this.mono() + (kept.endAt - this.now());
    this.setWatch({
      host: kept.host,
      minutes: kept.minutes,
      startedAt: end - kept.minutes * MINUTE,
      end,
    });
  }

  /** Whole minutes left in the watched session (0 once its planned end is passed). */
  minutesLeft(w) {
    return Math.max(0, Math.ceil((w.end - this.mono()) / MINUTE));
  }

  /**
   * Whether a status read on shows the session held to its duration: a
   * timer of 1 minute to what is left of the session (+1 for the rounding),
   * or 0 only in the last minute of the planned session.
   */
  heldToSession(status, w) {
    const left = status.powerTimer;
    if (!Number.isInteger(left)) {
      return false;
    }
    if (left === 0) {
      return this.mono() - w.startedAt >= w.minutes * MINUTE - MINUTE;
    }
    return left >= 1 && left <= Math.min(w.minutes, this.minutesLeft(w) + 1);
  }

  /** A status read through the session watch. */
  watchRead(status) {
    const w = this.sessionWatch;
    if (!w) {
      return;
    }
    if (w.host !== this.config.host) {
      this.clearWatch();
      return;
    }
    if (status.powerOn === false && !this.startMayLand) {
      // The session is over.
      this.clearWatch();
      return;
    }
    if (status.powerOn !== true) {
      return;
    }
    if (this.mono() >= w.end + TIMINGS.sessionWatchMargin) {
      this.sessionStop(w, this.generation, T.sessionOverrun).catch((err) =>
        this.logger.warn(`TOLO: turn off of the session failed (${err.message})`),
      );
      return;
    }
    if (!this.heldToSession(status, w)) {
      this.enforceTimer(w, this.generation);
    }
  }

  /**
   * The dedicated read at the planned end + margin: still on, it is turned
   * off. A read that fails sends the turn off too (protective, never a
   * silent end of the watch).
   */
  async endRead(w, generation) {
    let status;
    try {
      status = await this.client.status(w.host, {
        attempts: TIMINGS.readAttempts,
        attemptTimeout: TIMINGS.readAttemptTimeout,
      });
    } catch {
      status = undefined;
    }
    if (generation !== this.generation || this.sessionWatch !== w) {
      return;
    }
    if (status?.powerOn === false && !this.startMayLand) {
      this.show(generation, status);
      this.clearWatch();
      return;
    }
    this.sessionStop(w, generation, T.sessionOverrun).catch((err) =>
      this.logger.warn(`TOLO: turn off of the session failed (${err.message})`),
    );
  }

  /**
   * A session started from Gladys runs without a timer that holds it to its
   * duration: the timer is written with what is LEFT of the session (never
   * more: the integration never extends a session), then read strictly; a
   * timer still not within 1 minute to the value written, or a planned end
   * already passed, turns the App Box off. One at a time; never awaited by
   * an ack.
   */
  enforceTimer(w, generation) {
    if (w.enforcing) {
      return;
    }
    w.enforcing = true;
    const host = w.host;
    const run = async () => {
      const left = this.minutesLeft(w);
      if (left < 1) {
        await this.sessionStop(w, generation, T.timerStop);
        return;
      }
      this.logger.warn(
        `TOLO: a session started from Gladys is not held to its end, timer ${left} min`,
      );
      try {
        await this.client.set(host, 'timer', left, {
          attempts: TIMINGS.commandAttempts,
          attemptTimeout: TIMINGS.commandAttemptTimeout,
          beforeSend: () => {
            this.lastSentAt = this.mono();
          },
        });
      } catch {
        // The read decides.
      }
      let held;
      try {
        const after = await this.client.status(host, {
          attempts: TIMINGS.commandAttempts,
          attemptTimeout: TIMINGS.commandAttemptTimeout,
        });
        held =
          after.powerOn === false ||
          (Number.isInteger(after.powerTimer) && after.powerTimer >= 1 && after.powerTimer <= left);
      } catch {
        held = false;
      }
      if (held || this.sessionWatch !== w) {
        return;
      }
      await this.sessionStop(w, generation, T.timerStop);
    };
    run()
      .catch(() => {})
      .finally(() => {
        w.enforcing = false;
      });
  }

  /** Turns a watched session off: guard, log, alert in the status. */
  async sessionStop(w, generation, alert) {
    if (this.sessionWatch !== w) {
      return;
    }
    const host = w.host;
    this.logger.warn('TOLO: a session started from Gladys is not held to its duration, turn off');
    this.clearWatch();
    this.alert = alert(new Date(this.now()).toISOString().slice(11, 16));
    // A turn on not sent yet gives way, like any turn off.
    this.protectSeq += 1;
    const sentAt = this.mono();
    this.lastSentAt = sentAt;
    this.guardStop(sentAt, { host });
    try {
      await this.sendStop(host);
    } catch (err) {
      this.logger.warn(`TOLO: turn off of the session failed (${reasonOf(err).en})`);
    }
    if (generation === this.generation) {
      this.followUp();
      this.updateStatus().catch(() => {});
    }
  }

  /**
   * The power state just before a command that should not heat: the last
   * read if less than 10 s old, else a fresh read (by 1.5 s); undefined
   * when unknown (no side effect can then be told).
   */
  async powerBefore(host, received) {
    const b = this.box;
    if (b.status && this.mono() - b.readAt < TIMINGS.recentRead) {
      return b.status.powerOn;
    }
    const fresh = await this.readBack(host, 'status', received + TIMINGS.heatReadBy);
    return fresh?.powerOn;
  }

  /**
   * A command that should not heat turned the App Box on (off just before,
   * on just after, no turn on from Gladys in flight): turned off at once.
   */
  sideEffect(name, host, before, after) {
    if (after?.powerOn !== true || before !== false || this.heatEntry || this.startMayLand) {
      return;
    }
    this.logger.warn(`TOLO: the ${name.en} command turned the App Box on, turn off`);
    this.protectSeq += 1;
    const sentAt = this.mono();
    this.lastSentAt = sentAt;
    this.guardStop(sentAt, { host });
    this.sendStop(host)
      .then(() => this.followUp())
      .catch((err) => this.logger.warn(`TOLO: turn off failed (${reasonOf(err).en})`));
    throw this.refusal(ERRORS.sideEffect(name));
  }

  // --- Turn off ----------------------------------------------------------------

  stopGuardActive() {
    if (this.stopGuard && this.mono() >= this.stopGuard.until) {
      this.stopGuard = undefined;
      this.persistStopGuard();
    }
    return Boolean(this.stopGuard);
  }

  /** The guard into /data (wall clock), in the background: a turn off never waits for it. */
  persistStopGuard() {
    const g = this.stopGuard;
    this.memory.stopGuard = g
      ? {
          host: g.host,
          until: this.now() + Math.max(0, g.until - this.mono()),
          reasserts: g.reasserts,
          sticky: g.sticky,
        }
      : null;
    this.saveMemory().catch(() => {});
  }

  /** The guard kept in /data for the configured address, back in memory. */
  restoreStopGuard() {
    const kept = this.memory.stopGuard;
    if (!kept || kept.host !== this.config.host) {
      this.stopGuard = undefined;
      return;
    }
    if (this.stopGuard?.host === kept.host) {
      return;
    }
    this.stopGuard = {
      host: kept.host,
      // A turn off sent before this start: every power on of this run is newer.
      sentAt: this.mono(),
      until: this.mono() + Math.min(TIMINGS.guard, Math.max(0, kept.until - this.now())),
      reasserts: kept.reasserts,
      sticky: kept.sticky,
    };
  }

  /**
   * Sets (or keeps) the guard of a turn off sent at `sentAt` to `host`: the
   * reads of the next 2 min send it again if the App Box heats. `sticky`: a
   * turn on left before it (it may land after): lifted by time only.
   */
  guardStop(sentAt, { sticky = false, host = this.config.host } = {}) {
    if (this.stopGuardActive() && this.stopGuard.host === host) {
      this.stopGuard.sticky ||= sticky;
      this.stopGuard.sentAt = Math.max(this.stopGuard.sentAt, sentAt);
    } else {
      this.stopGuard = {
        host,
        sentAt,
        until: this.mono() + TIMINGS.guard,
        reasserts: 0,
        sticky,
      };
    }
    this.persistStopGuard();
  }

  /**
   * One turn off exchange, counted while in flight (every turn on waits for
   * it): 4 datagrams at most while the App Box is silent or a socket error
   * (ICMP) ends an attempt.
   */
  sendStop(host) {
    this.stopsInFlight += 1;
    const sending = this.client.set(host, 'power', false, {
      attempts: TIMINGS.stopAttempts,
      attemptTimeout: TIMINGS.commandAttemptTimeout,
      beforeSend: () => {
        this.lastSentAt = this.mono();
      },
    });
    sending
      .finally(() => {
        this.stopsInFlight -= 1;
      })
      .catch(() => {});
    return sending;
  }

  /**
   * TURN OFF: never held back, no read before it (it decides nothing: it is
   * always sent, never answered "already off"). Confirmed only by a read
   * showing the power off with no turn on that may still land; any turn off
   * without that confirmation gets a guard. An answer saying "refused" is
   * judged on the read as well.
   */
  async turnOff(received, host) {
    // A turn on not sent yet gives way.
    this.protectSeq += 1;
    const generation = this.generation;
    const overtaken = this.heatEntry;
    const sentAt = this.mono();
    this.lastSentAt = sentAt;
    if (this.startMayLand) {
      this.guardStop(sentAt, { sticky: true, host });
    }
    this.logger.info('TOLO: turn off');
    const sending = this.sendStop(host);
    if (overtaken?.sentAt !== undefined && !overtaken.answered) {
      this.stopAgain(overtaken, sentAt, host);
    }
    let accepted;
    try {
      accepted = await sending;
    } catch (err) {
      this.logger.warn(`TOLO: turn off failed (${reasonOf(err).en})`);
      if (!mayHaveLeft(err)) {
        throw this.refusal(ERRORS.notSent(reasonOf(err)));
      }
      this.guardStop(sentAt, { host });
      this.followUp();
      throw this.refusal(ERRORS.sentUnconfirmed(reasonOf(err)));
    }
    const after = await this.readBack(host, 'status', received + TIMINGS.commandAnswerBy);
    this.followUp();
    if (after === undefined) {
      this.guardStop(sentAt, { host });
      throw this.refusal(
        ERRORS.sentUnconfirmed(accepted ? ERRORS.noReadBack : ERRORS.answerRefused),
      );
    }
    this.show(generation, after);
    if (after.powerOn !== false) {
      this.guardStop(sentAt, { host });
      throw this.refusal(
        accepted
          ? ERRORS.sentUnconfirmed(ERRORS.readBack(statusText(after)))
          : ERRORS.refusedButReads(statusText(after)),
      );
    }
    if (this.startMayLand) {
      // Off now, but a turn on sent before may still land: the guard watches.
      this.guardStop(sentAt, { sticky: true, host });
    }
    // Off, as read (also after an answer saying "refused": the state is what counts).
    return undefined;
  }

  /**
   * A turn off that overtook a turn on already sent: sent once more when
   * that turn on settles (no read, no option check: it repeats a turn off
   * decided). The guard stays either way.
   */
  stopAgain(heatEntry, stopAt, host) {
    heatEntry.promise
      .catch(() => {})
      .then(async () => {
        if (this.lastStartAt > stopAt || (this.config.host && this.config.host !== host)) {
          return;
        }
        this.logger.warn('TOLO: turn off sent again after the turn on in flight');
        await this.sendStop(host);
        this.followUp();
      })
      .catch((err) => {
        this.logger.warn(`TOLO: turn off again failed (${reasonOf(err).en})`);
        this.followUp();
      });
  }

  /**
   * A status read through the guards: a turn on confirmed (power on); the
   * session timer of a turn on from Gladys; a turn off confirmed (power off,
   * nothing in flight, not sticky), or reaffirmed if the App Box heats again
   * (same address only, 3 times at most, never by the read back of a
   * command nor while a turn on or a turn off is in flight).
   */
  observe(status, { fromCommand = false } = {}) {
    if (status.powerOn === true && this.mono() < this.unconfirmedStartUntil) {
      // On: the turn on landed, it cannot land any more.
      this.unconfirmedStartUntil = -Infinity;
    }
    this.watchRead(status);
    if (!this.stopGuardActive()) {
      return;
    }
    const guard = this.stopGuard;
    if (guard.host !== this.config.host) {
      this.stopGuard = undefined;
      this.persistStopGuard();
      return;
    }
    if (status.powerOn === false) {
      if (!guard.sticky && this.stopsInFlight === 0 && !this.startMayLand) {
        this.stopGuard = undefined;
        this.persistStopGuard();
      }
      return;
    }
    if (status.powerOn !== true) {
      return;
    }
    const startInFlight = this.heatEntry?.sentAt !== undefined && !this.heatEntry.answered;
    if (
      !fromCommand &&
      this.lastStartAt <= guard.sentAt &&
      !startInFlight &&
      this.stopsInFlight === 0 &&
      guard.reasserts < TIMINGS.stopReasserts
    ) {
      guard.reasserts += 1;
      this.persistStopGuard();
      this.logger.warn('TOLO: the App Box heats again after a turn off, turn off sent again');
      this.sendStop(guard.host)
        .then(() => this.followUp())
        .catch((err) => this.logger.warn(`TOLO: turn off reaffirmed failed (${reasonOf(err).en})`));
    }
  }

  // --- Setpoint, lamp, fan -------------------------------------------------------

  /**
   * The setpoint: behind the option, capped, one at a time, confirmed by the
   * settings. While a turn off is in flight, not confirmed (its guard) or
   * asked meanwhile, only a lower setpoint than the one known is accepted.
   */
  async setpoint(received, temperature) {
    const generation = this.generation;
    const host = this.config.host;
    const seq = this.protectSeq;
    const known = this.box.settings?.targetTemperature;
    const lastChecks = () => {
      this.checkHeat(generation, host);
      if (temperature > this.config.maxTemperature) {
        throw this.refusal(ERRORS.badSetpoint(TEMPERATURE.min, this.config.maxTemperature));
      }
      const stopping = this.stopsInFlight > 0 || this.stopGuardActive() || this.protectSeq !== seq;
      if (stopping && (known === undefined || temperature > known)) {
        throw this.refusal(ERRORS.raiseDuringStop);
      }
    };
    lastChecks();
    return this.oneAtATime(FEATURES.TARGET, async () => {
      const before = await this.powerBefore(host, received);
      const accepted = await this.sendSet(host, received, 'target', temperature, lastChecks);
      const answerBy = received + TIMINGS.commandAnswerBy;
      const [after, status] = await Promise.all([
        this.readBack(host, 'settings', answerBy),
        this.readBack(host, 'status', answerBy),
      ]);
      this.followUp();
      if (status) {
        this.show(generation, status);
        this.sideEffect(ERRORS.SETPOINT, host, before, status);
      }
      if (after === undefined) {
        throw this.refusal(
          ERRORS.sentUnconfirmed(accepted ? ERRORS.noReadBack : ERRORS.answerRefused),
        );
      }
      this.show(generation, undefined, after);
      if (after.targetTemperature !== temperature) {
        const read = {
          en: `${after.targetTemperature ?? '?'} °C`,
          fr: `${after.targetTemperature ?? '?'} °C`,
        };
        throw this.refusal(
          accepted ? ERRORS.sentUnconfirmed(ERRORS.readBack(read)) : ERRORS.refused,
        );
      }
      // The setpoint asked, as read (also after an answer saying "refused").
      return undefined;
    });
  }

  /**
   * Lamp or fan: a plain set, confirmed by a status read. According to
   * tololib they only drive their output; should one turn the App Box on
   * (off just before, no turn on from Gladys in flight), it is turned off at
   * once and the command refused.
   */
  async plainSet(role, on, received) {
    const generation = this.generation;
    const host = this.config.host;
    const name = role === FEATURES.LAMP ? ERRORS.LAMP : ERRORS.FAN;
    return this.oneAtATime(role, async () => {
      const before = await this.powerBefore(host, received);
      const command = role === FEATURES.LAMP ? 'lamp' : 'fan';
      const accepted = await this.sendSet(host, received, command, on, () => {
        if (generation !== this.generation || host !== this.config.host) {
          throw this.refusal(ERRORS.configChangedPlain);
        }
      });
      const after = await this.readBack(host, 'status', received + TIMINGS.commandAnswerBy);
      this.followUp();
      if (after === undefined) {
        throw this.refusal(
          ERRORS.sentUnconfirmed(accepted ? ERRORS.noReadBack : ERRORS.answerRefused),
        );
      }
      this.show(generation, after);
      this.sideEffect(name, host, before, after);
      const read = role === FEATURES.LAMP ? after.lampOn : after.fanOn;
      if (read !== on) {
        throw this.refusal(
          accepted ? ERRORS.sentUnconfirmed(ERRORS.readBack(statusText(after))) : ERRORS.refused,
        );
      }
      return undefined;
    });
  }

  async oneAtATime(role, work) {
    if (this.busy.has(role)) {
      throw this.refusal(ERRORS.busy);
    }
    this.busy.add(role);
    try {
      return await work();
    } finally {
      this.busy.delete(role);
    }
  }

  /**
   * One set of a non-protective command: resolves whether the App Box
   * answered "accepted" (the caller reads back either way); throws "not
   * sent" or "sent, without confirmation" when no answer came.
   */
  async sendSet(host, received, command, value, check) {
    try {
      return await this.client.set(
        host,
        command,
        value,
        this.commandOptions(
          received + TIMINGS.commandSendBy,
          received + TIMINGS.commandAnswerBy,
          () => {
            check();
            this.lastSentAt = this.mono();
          },
        ),
      );
    } catch (err) {
      if (!mayHaveLeft(err)) {
        if (err instanceof Refusal) {
          throw err;
        }
        throw this.refusal(ERRORS.notSent(reasonOf(err)));
      }
      this.followUp();
      throw this.refusal(ERRORS.sentUnconfirmed(reasonOf(err)));
    }
  }

  /**
   * Spaced reads after a command: its effect, then a check. One series
   * pending at a time (a scene pressing in a loop never multiplies them).
   */
  followUp() {
    const generation = this.generation;
    const b = this.box;
    for (const handle of b.followUps) {
      this.timers.clearTimeout(handle);
    }
    b.followUps.clear();
    for (const delay of TIMINGS.followUps) {
      const handle = this.timers.setTimeout(() => {
        b.followUps.delete(handle);
        if (generation === this.generation) {
          Promise.resolve(b.running)
            .then(() => this.tick())
            .catch(() => this.logger.error('TOLO refresh failed'));
        }
      }, delay);
      b.followUps.add(handle);
    }
  }
}
