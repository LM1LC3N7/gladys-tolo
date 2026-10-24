// -----------------------------------------------------------------------------
// TOLO constants, limits and timings.
//
// A TOLO steam generator or sauna with its App Box is reached on the local
// network, in UDP on port 51500 (src/tolo/protocol.js), as the `tololib`
// Python library (MIT, Matthias Lohr, 1.2.2, the library of the TOLO
// integration of Home Assistant) talks to it. No account, no cloud, no
// secret: the App Box answers whoever asks on the network.
// -----------------------------------------------------------------------------

import { DEVICE_LIMITS } from './tolo/protocol.js';

/**
 * Setpoints (°C). The App Box takes 35 to 60 °C (tololib const.py); Gladys
 * never asks for more than the "Highest setpoint" of the configuration
 * (50 °C by default).
 */
export const TEMPERATURE = {
  min: DEVICE_LIMITS.targetTemperatureMin,
  max: DEVICE_LIMITS.targetTemperatureMax,
  defaultMax: 50,
};

/**
 * The timer of a session started from Gladys (minutes): the App Box takes 1
 * to 60; 30 by default. Never "no timer".
 */
export const DURATION = {
  min: 1,
  max: DEVICE_LIMITS.powerTimerMax,
  default: 30,
};

/** Feature roles (the last part of the feature external ids): frozen forever. */
export const FEATURES = {
  HEATING: 'heating',
  STATUS: 'status',
  TEMPERATURE: 'temperature',
  HUMIDITY: 'humidity',
  TARGET: 'target-temperature',
  REMAINING: 'remaining',
  WATER: 'water-level',
  TANK: 'tank-temperature',
  LAMP: 'lamp',
  FAN: 'fan',
  HEAT_ON: 'heat-on',
  HEAT_OFF: 'heat-off',
};

export const ACTIONS = {
  TEST_CONNECTION: 'test_connection',
};

/** The value a `button/push` feature sends (BUTTON_PUSH.PRESSED of the core). */
export const PRESSED = 1;

/** The platform id of the one App Box of the configuration. FROZEN (external ids). */
export const APP_BOX_ID = 'appbox';

/** The poll interval of the configuration, in seconds. */
export const POLL_INTERVAL = {
  min: 10,
  max: 3600,
  default: 30,
};

export const LIMITS = {
  /** Gladys: 300 states per minute, for the whole integration (some room kept). */
  statesPerMinute: 280,
  statesPerRequest: 100,
  /** The longest address typed (an IPv4 address is 15 characters). */
  hostMax: 64,
};

export const SECOND = 1_000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;

export const TIMINGS = {
  /** A polling read: 3 datagrams, 1 s apart, at most. */
  readAttempts: 3,
  readAttemptTimeout: SECOND,
  /** Failed reads: 30 s, 1, 2, then 5 min, never shorter than the interval. */
  backoff: [30 * SECOND, MINUTE, 2 * MINUTE, 5 * MINUTE],
  /** The time of the last read is written to /data at most this often. */
  attemptWriteEvery: MINUTE,
  /** The publisher sends what is pending every second; unchanged states again every 30 min. */
  flushInterval: SECOND,
  stateHeartbeat: 30 * MINUTE,
  /**
   * Commands (Gladys waits 5 s for the ack): turning on must leave by 3.5 s
   * after the click, or it is refused unsent; every answer is awaited until
   * 4.3 s, after which the command is "sent, without confirmation".
   */
  commandSendBy: 3_500,
  /** The steps of a turn on, from the click: fresh reads, timer and setpoint, their read back. */
  heatReadBy: 1_500,
  heatPrepareBy: 2_400,
  heatCheckBy: 3_200,
  commandAnswerBy: 4_300,
  /** One exchange of a command: 2 datagrams, 400 ms apart. */
  commandAttempts: 2,
  commandAttemptTimeout: 400,
  /** A turn off: 4 datagrams, 400 ms apart, as long as the App Box is silent. */
  stopAttempts: 4,
  /** Reads after a command, spaced: its effect, then a check. */
  followUps: [5 * SECOND, 20 * SECOND],
  /** After a start with a turn off guard restored from /data: one read this soon. */
  guardRead: 5 * SECOND,
  /** A session watch lasts the session duration plus this margin. */
  sessionWatchMargin: 2 * MINUTE,
  /** A command not seen yet keeps its guard this long. */
  guard: 2 * MINUTE,
  /** A turn off sent again at most this often while heating may land after it. */
  stopReasserts: 3,
  /** "Nothing to send" may be decided on a read this recent (never a decision to send). */
  recentRead: 10 * SECOND,
};
