// -----------------------------------------------------------------------------
// The App Box -> one Gladys device and its states (pure).
//
// `ext:<selector>:tolo:appbox`: one device per integration, the App Box at
// the configured address. The protocol gives no serial number nor MAC
// address, so there is no identity to key on: an App Box that changes
// address stays the same device (FROZEN RULE, see TODO.md "Decisions"). The
// feature roles (the last part of their external ids) are published forever:
// never rename them. A republished device keeps every feature of the device
// already created.
//
// Heating must never start through an "everything on" (Google Home, Alexa,
// HomeKit, MCP, `switch.*` scenes): no switch, no writable binary for it.
// The heating state is read only (`unknown/binary`); turning on and turning
// off are two `button/push` features. The setpoint
// (`thermostat/target-temperature`) is writable, behind the same option as
// turning on. The lamp (`light/binary`) and the fan (`switch/binary`) heat
// nothing: plain on/off.
//
// Categories and units are those the core lists
// (DEVICE_FEATURE_UNITS_BY_CATEGORY): °C on temperature-sensor and
// thermostat; % on humidity-sensor and level-sensor; minutes on duration.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { APP_BOX_ID, FEATURES, TEMPERATURE } from './constants.js';
import { DEVICE_NAME, FEATURE_NAMES, statusText, word } from './i18n.js';
import { waterPercent } from './tolo/protocol.js';

const sensor = (definition) => ({
  read_only: true,
  has_feedback: false,
  keep_history: true,
  ...definition,
});
const button = {
  category: C.BUTTON,
  type: T.BUTTON.PUSH,
  min: 0,
  max: 1,
  read_only: false,
  has_feedback: false,
  keep_history: false,
};
const temperature = sensor({
  category: C.TEMPERATURE_SENSOR,
  type: T.SENSOR.DECIMAL,
  unit: U.CELSIUS,
  min: 0,
  max: 150,
});

/** The features, by role, in display order. */
export const DEFINITIONS = {
  [FEATURES.HEATING]: sensor({ category: C.UNKNOWN, type: T.SENSOR.BINARY, min: 0, max: 1 }),
  [FEATURES.STATUS]: sensor({
    category: C.TEXT,
    type: T.TEXT.TEXT,
    min: 0,
    max: 0,
    keep_history: false,
  }),
  [FEATURES.TEMPERATURE]: temperature,
  [FEATURES.HUMIDITY]: sensor({
    category: C.HUMIDITY_SENSOR,
    type: T.SENSOR.DECIMAL,
    unit: U.PERCENT,
    min: 0,
    max: 100,
  }),
  [FEATURES.TARGET]: {
    category: C.THERMOSTAT,
    type: T.THERMOSTAT.TARGET_TEMPERATURE,
    unit: U.CELSIUS,
    min: TEMPERATURE.min,
    max: TEMPERATURE.max,
    read_only: false,
    has_feedback: true,
    keep_history: true,
  },
  [FEATURES.REMAINING]: sensor({
    category: C.DURATION,
    type: T.DURATION.INTEGER,
    unit: U.MINUTES,
    min: 0,
    max: 60,
  }),
  [FEATURES.WATER]: sensor({
    category: C.LEVEL_SENSOR,
    type: T.LEVEL_SENSOR.LIQUID_LEVEL_PERCENT,
    unit: U.PERCENT,
    min: 0,
    max: 100,
  }),
  [FEATURES.TANK]: temperature,
  [FEATURES.LAMP]: {
    category: C.LIGHT,
    type: T.LIGHT.BINARY,
    min: 0,
    max: 1,
    read_only: false,
    has_feedback: true,
    keep_history: true,
  },
  [FEATURES.FAN]: {
    category: C.SWITCH,
    type: T.SWITCH.BINARY,
    min: 0,
    max: 1,
    read_only: false,
    has_feedback: true,
    keep_history: true,
  },
  [FEATURES.HEAT_ON]: button,
  [FEATURES.HEAT_OFF]: button,
};

export const ROLES = Object.keys(DEFINITIONS);
/** The writable roles. */
export const COMMAND_ROLES = [
  FEATURES.HEAT_ON,
  FEATURES.HEAT_OFF,
  FEATURES.TARGET,
  FEATURES.LAMP,
  FEATURES.FAN,
];

export const appBoxIds = (gladys) => gladys.externalIds('tolo', APP_BOX_ID);

/** The role of one of our feature external ids, else undefined. */
export function parseFeatureId(gladys, externalId) {
  if (typeof externalId !== 'string' || externalId.length > 300) {
    return undefined;
  }
  const prefix = `${appBoxIds(gladys).device}:`;
  if (!externalId.startsWith(prefix)) {
    return undefined;
  }
  const role = externalId.slice(prefix.length);
  return ROLES.includes(role) ? role : undefined;
}

/** The Gladys device of the App Box (every role, plus those of the device already created). */
export function buildDevice(gladys, { language }) {
  const ids = appBoxIds(gladys);
  return {
    name: word(DEVICE_NAME, language),
    external_id: ids.device,
    model: 'TOLO App Box',
    should_poll: false,
    features: ROLES.map((role) => ({
      name: word(FEATURE_NAMES[role], language),
      external_id: ids.feature(role),
      ...DEFINITIONS[role],
    })),
  };
}

const bit = (value) => (value === undefined ? undefined : value ? 1 : 0);

/**
 * The current values: `[{ role, state }]` or `[{ role, text }]`. A value
 * missing or outside the bounds of its feature is dropped (Gladys keeps the
 * last one). Never undefined, never NaN.
 */
export function statesOf(status, settings, { language }) {
  const states = [];
  const add = (role, value) => {
    const { min, max } = DEFINITIONS[role];
    if (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max) {
      states.push({ role, state: value });
    }
  };
  if (status) {
    states.push({ role: FEATURES.STATUS, text: word(statusText(status), language) });
    add(FEATURES.HEATING, bit(status.powerOn));
    add(FEATURES.TEMPERATURE, status.temperature);
    add(FEATURES.HUMIDITY, status.humidity);
    // Off: nothing left. On without a timer (null): unknown, the last value stays.
    add(FEATURES.REMAINING, status.powerOn === false ? 0 : (status.powerTimer ?? undefined));
    add(FEATURES.WATER, waterPercent(status.waterLevel));
    add(FEATURES.TANK, status.tankTemperature);
    add(FEATURES.LAMP, bit(status.lampOn));
    add(FEATURES.FAN, bit(status.fanOn));
  }
  if (settings) {
    add(FEATURES.TARGET, settings.targetTemperature);
  }
  return states;
}
