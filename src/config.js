// -----------------------------------------------------------------------------
// The configuration: the manifest `config_schema` values, normalized so the
// rest of the code never deals with strings typed in a form. There is no
// secret: the App Box has no password.
// -----------------------------------------------------------------------------

import { DURATION, LIMITS, POLL_INTERVAL, TEMPERATURE } from './constants.js';

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULT_CONFIG = {
  host: '',
  allow_heating: false,
  session_minutes: DURATION.default,
  max_temperature: TEMPERATURE.defaultMax,
  poll_interval: POLL_INTERVAL.default,
  language: 'fr',
};

/** Only `true` (or the text "true") allows: anything else, missing included, refuses. */
const strictTrue = (value) => value === true || value === 'true';

/** A whole number from a form (5 or "5"), else undefined: '' and null are never 0. */
function whole(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.round(value) : undefined;
  }
  if (typeof value === 'string' && /^\s*\d{1,6}(?:\.\d+)?\s*$/.test(value)) {
    return Math.round(Number(value));
  }
  return undefined;
}

const bounded = (value, { min, max }, fallback) => {
  const n = whole(value);
  return n === undefined ? fallback : Math.min(max, Math.max(min, n));
};

/**
 * The address of the App Box: a unicast IPv4 address of the local network,
 * else undefined. Refused: 0.0.0.0/8, loopback (the container itself),
 * link-local, multicast, reserved and broadcast (255.255.255.255, and any
 * address ending in .255, a usual subnet broadcast).
 */
export function hostOf(value) {
  if (typeof value !== 'string') {
    return undefined;
  }
  const text = value.trim();
  if (text.length > LIMITS.hostMax) {
    return undefined;
  }
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (!match) {
    return undefined;
  }
  const parts = match.slice(1).map(Number);
  if (parts.some((p, i) => p > 255 || (match[i + 1].length > 1 && match[i + 1][0] === '0'))) {
    return undefined;
  }
  const [a, b, , d] = parts;
  if (a === 0 || a === 127 || a >= 224 || (a === 169 && b === 254) || d === 255) {
    return undefined;
  }
  return parts.join('.');
}

export function normalizeConfig(raw = {}) {
  const c = { ...DEFAULT_CONFIG };
  for (const [key, value] of Object.entries(raw ?? {})) {
    if (Object.hasOwn(DEFAULT_CONFIG, key) && value != null) {
      c[key] = value;
    }
  }
  const typed = typeof c.host === 'string' ? c.host.trim() : '';
  const host = hostOf(typed);
  return {
    /** The App Box address, or undefined while missing or invalid. */
    host,
    /** An address was typed but refused. */
    badHost: typed !== '' && host === undefined,
    allowHeating: strictTrue(c.allow_heating),
    /** The timer of a session started from Gladys: 1 to 60 min (30 by default). */
    sessionMinutes: bounded(c.session_minutes, DURATION, DURATION.default),
    /** The highest setpoint ever sent: 35 to 60 °C (50 by default). */
    maxTemperature: bounded(c.max_temperature, TEMPERATURE, TEMPERATURE.defaultMax),
    pollInterval: bounded(c.poll_interval, POLL_INTERVAL, POLL_INTERVAL.default),
    language: c.language === 'en' ? 'en' : 'fr',
  };
}

/** Whether the configuration can be used to read the App Box. */
export const usable = (config) => Boolean(config.host);
