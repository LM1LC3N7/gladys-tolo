// -----------------------------------------------------------------------------
// The TOLO App Box protocol (pure, no I/O), ported from tololib 1.2.2 (MIT,
// Matthias Lohr, the library of the TOLO integration of Home Assistant):
// message.py, enums.py, state.py, protocol.py, const.py. The protocol is not
// documented by TOLO: tololib was written by observing the App Box.
//
// One UDP datagram per message, to port 51500 of the App Box, each answered
// by one datagram of the same shape:
//   AA AA | command code (1 byte) | command value (1 byte) | extra (n bytes) | 55 55 | XOR of all before
// Requests carry the extra byte FF. A "set" is answered with the same command
// and the extra byte 00 (accepted); the status (97) with value 0x11 and 17
// bytes; the settings (99) with value 0x08 and 8 bytes (7 on some firmware:
// tololib then reads the lamp mode as manual). The App Box may also send a
// one-byte keep-alive (0x2B), ignored.
//
// Parsing here is strict: a datagram longer than LIMITS.datagram, a wrong
// prefix, suffix or checksum, an unexpected command, value or length is
// refused (undefined), never half read. A field outside its known range is
// left undefined (the feature then keeps its last value).
// -----------------------------------------------------------------------------

export const PORT = 51500;
export const KEEP_ALIVE = 0x2b;

/** The command codes used here (tololib `Command`); the others are never sent. */
export const COMMAND = {
  SET_TARGET_TEMPERATURE: 4,
  SET_POWER_TIMER: 8,
  SET_POWER_ON: 14,
  SET_LAMP_ON: 30,
  SET_FAN_ON: 34,
  GET_STATUS: 97,
  GET_SETTINGS: 99,
};

/** Bounds of the App Box (tololib const.py). */
export const DEVICE_LIMITS = {
  targetTemperatureMin: 35,
  targetTemperatureMax: 60,
  powerTimerMax: 60,
};

/** Calefaction (tololib `Calefaction`): the low 2 bits of status byte 3. */
export const CALEFACTION = { HEAT: 0, INACTIVE: 1, UNCLEAR: 2, KEEP: 3 };

/** The longest datagram ever read: the status answer is 24 bytes. */
export const MAX_DATAGRAM = 64;

const PREFIX = 0xaa;
const SUFFIX = 0x55;
const REQUEST_EXTRA = 0xff;
const STATUS_VALUE = 0x11;
const SETTINGS_VALUE = 0x08;
const STATUS_LENGTH = 17;
/** "No timer" in the status (power and fan timers). */
const TIMER_OFF_STATUS = 61;
/** "No timer" in the settings (power timer). */
const TIMER_OFF_SETTINGS = 0xff;

const xor = (bytes) => bytes.reduce((crc, b) => crc ^ b, 0);

const isByte = (n) => Number.isInteger(n) && n >= 0 && n <= 255;

/** One request: `AA AA code value FF 55 55 crc` (8 bytes). */
export function encode(code, value) {
  if (!Object.values(COMMAND).includes(code) || !isByte(value)) {
    throw new RangeError('not a command of this integration');
  }
  const body = [PREFIX, PREFIX, code, value, REQUEST_EXTRA, SUFFIX, SUFFIX];
  return Buffer.from([...body, xor(body)]);
}

/** The requests of tololib protocol.py. */
export const REQUESTS = {
  status: () => encode(COMMAND.GET_STATUS, STATUS_VALUE),
  settings: () => encode(COMMAND.GET_SETTINGS, SETTINGS_VALUE),
  powerOn: (on) => encode(COMMAND.SET_POWER_ON, on ? 1 : 0),
  lampOn: (on) => encode(COMMAND.SET_LAMP_ON, on ? 1 : 0),
  fanOn: (on) => encode(COMMAND.SET_FAN_ON, on ? 1 : 0),
  targetTemperature(t) {
    if (
      !Number.isInteger(t) ||
      t < DEVICE_LIMITS.targetTemperatureMin ||
      t > DEVICE_LIMITS.targetTemperatureMax
    ) {
      throw new RangeError('setpoint out of the App Box range');
    }
    return encode(COMMAND.SET_TARGET_TEMPERATURE, t);
  },
  powerTimer(minutes) {
    // Never "no timer" (0xFF): every session started from Gladys has an end.
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > DEVICE_LIMITS.powerTimerMax) {
      throw new RangeError('timer out of the App Box range');
    }
    return encode(COMMAND.SET_POWER_TIMER, minutes);
  },
};

/**
 * One datagram -> `{ code, value, extra }` when it is a well-formed message
 * (prefix, suffix, checksum, bounded length), else undefined. The keep-alive
 * byte is undefined too (the caller checks it with isKeepAlive).
 */
export function decode(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 7 || buffer.length > MAX_DATAGRAM) {
    return undefined;
  }
  const n = buffer.length;
  if (
    buffer[0] !== PREFIX ||
    buffer[1] !== PREFIX ||
    buffer[n - 3] !== SUFFIX ||
    buffer[n - 2] !== SUFFIX ||
    xor(buffer.subarray(0, n - 1)) !== buffer[n - 1]
  ) {
    return undefined;
  }
  return { code: buffer[2], value: buffer[3], extra: Buffer.from(buffer.subarray(4, n - 3)) };
}

export const isKeepAlive = (buffer) =>
  Buffer.isBuffer(buffer) && buffer.length === 1 && buffer[0] === KEEP_ALIVE;

const flag = (b) => (b === 0 || b === 1 ? b === 1 : undefined);
const within = (b, min, max) => (b >= min && b <= max ? b : undefined);
/** A remaining time: 1..60 min, 61 = no timer (null), anything else unknown. */
const statusTimer = (b) => {
  if (b === TIMER_OFF_STATUS) {
    return null;
  }
  return within(b, 0, 60);
};

/**
 * The status answer (tololib state.py `ToloStatus.from_bytes`), or undefined
 * when the message is not one. Fields:
 *   powerOn, temperature (°C), powerTimer (min left, null = no timer),
 *   calefaction (0..3), flowIn, flowOut, aromaOn, sweepOn, lampOn,
 *   waterLevel (0..3), fanOn, fanTimer, humidity (%), tankTemperature (°C),
 *   model (0 domestic, 1 commercial), saltBathOn.
 */
export function parseStatus(message) {
  if (
    !message ||
    message.code !== COMMAND.GET_STATUS ||
    message.value !== STATUS_VALUE ||
    message.extra.length !== STATUS_LENGTH
  ) {
    return undefined;
  }
  const d = message.extra;
  const status = {
    powerOn: flag(d[0]),
    temperature: within(d[1], 0, 150),
    powerTimer: statusTimer(d[2]),
    calefaction: d[3] & 3,
    flowIn: Boolean(d[3] & 64),
    flowOut: Boolean(d[3] & 16),
    aromaOn: flag(d[4]),
    sweepOn: flag(d[5]),
    lampOn: flag(d[7]),
    waterLevel: within(d[8], 0, 3),
    fanOn: flag(d[9]),
    fanTimer: statusTimer(d[10]),
    humidity: within(d[11], 0, 100),
    tankTemperature: within(d[12], 0, 150),
    model: within(d[14], 0, 1),
    saltBathOn: flag(d[15]),
  };
  return status;
}

/**
 * The settings answer (tololib state.py `ToloSettings.from_bytes`), or
 * undefined. Fields: targetTemperature (°C, within the App Box range else
 * undefined), powerTimer (1..60 min, null = no timer, else undefined),
 * targetHumidity (%).
 */
export function parseSettings(message) {
  if (
    !message ||
    message.code !== COMMAND.GET_SETTINGS ||
    message.value !== SETTINGS_VALUE ||
    (message.extra.length !== 8 && message.extra.length !== 7)
  ) {
    return undefined;
  }
  const d = message.extra;
  let powerTimer;
  if (d[1] === TIMER_OFF_SETTINGS) {
    powerTimer = null;
  } else {
    powerTimer = within(d[1], 1, DEVICE_LIMITS.powerTimerMax);
  }
  return {
    targetTemperature: within(
      d[0],
      DEVICE_LIMITS.targetTemperatureMin,
      DEVICE_LIMITS.targetTemperatureMax,
    ),
    powerTimer,
    targetHumidity: within(d[5], 60, 99),
  };
}

/**
 * The answer of a set: `true` accepted (extra 00), `false` refused (another
 * extra), undefined when it is not the answer of that command.
 */
export function parseSetAnswer(message, code) {
  if (!message || message.code !== code) {
    return undefined;
  }
  return message.extra.length === 1 && message.extra[0] === 0x00;
}

/** Water level 0..3 -> percent (tololib `water_level_percent`). */
export const waterPercent = (level) => [0, 33, 66, 100][level];
