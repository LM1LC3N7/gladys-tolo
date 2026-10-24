// -----------------------------------------------------------------------------
// Configuration, devices and /data: the pure parts.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { DEFAULT_CONFIG, hostOf, normalizeConfig } from '../src/config.js';
import { FEATURES, TIMINGS } from '../src/constants.js';
import { DEFINITIONS, buildDevice, parseFeatureId, statesOf } from '../src/devices.js';
import { normalizeMemory } from '../src/store.js';

test('the defaults: heating off, 30 min, 50 °C at most, every 30 s', () => {
  const c = normalizeConfig();
  assert.equal(c.host, undefined);
  assert.equal(c.badHost, false);
  assert.equal(c.allowHeating, false);
  assert.equal(c.sessionMinutes, 30);
  assert.equal(c.maxTemperature, 50);
  assert.equal(c.pollInterval, 30);
  assert.equal(DEFAULT_CONFIG.allow_heating, false);
});

test('heating is allowed only by true', () => {
  for (const value of [1, 'yes', 'TRUE', {}, null, undefined, 'false', false]) {
    assert.equal(normalizeConfig({ allow_heating: value }).allowHeating, false, String(value));
  }
  assert.equal(normalizeConfig({ allow_heating: 'true' }).allowHeating, true);
  assert.equal(normalizeConfig({ allow_heating: true }).allowHeating, true);
});

test('duration and setpoint bounded by the App Box limits; empty is the default', () => {
  assert.equal(normalizeConfig({ session_minutes: 600 }).sessionMinutes, 60);
  assert.equal(normalizeConfig({ session_minutes: 0 }).sessionMinutes, 1);
  assert.equal(normalizeConfig({ session_minutes: '' }).sessionMinutes, 30);
  assert.equal(normalizeConfig({ session_minutes: '45' }).sessionMinutes, 45);
  assert.equal(normalizeConfig({ max_temperature: 90 }).maxTemperature, 60);
  assert.equal(normalizeConfig({ max_temperature: 20 }).maxTemperature, 35);
  assert.equal(normalizeConfig({ max_temperature: 'hot' }).maxTemperature, 50);
  assert.equal(normalizeConfig({ poll_interval: 1 }).pollInterval, 10);
  assert.equal(normalizeConfig({ poll_interval: null }).pollInterval, 30);
});

test('the address: a unicast IPv4 address of the network only', () => {
  assert.equal(hostOf(' 192.168.1.50 '), '192.168.1.50');
  assert.equal(hostOf('10.0.0.1'), '10.0.0.1');
  for (const bad of [
    '',
    'tolo.local',
    '192.168.1',
    '192.168.1.256',
    '192.168.01.5',
    '0.0.0.0',
    '127.0.0.1',
    '169.254.1.1',
    '224.0.0.1',
    '239.255.255.250',
    '255.255.255.255',
    '192.168.1.255',
    '192.168.1.5\u00000',
    '::1',
    42,
    null,
  ]) {
    assert.equal(hostOf(bad), undefined, String(bad));
  }
  const c = normalizeConfig({ host: '192.168.1.255' });
  assert.equal(c.host, undefined);
  assert.equal(c.badHost, true);
});

test('the device: frozen ids, units of the core, every role', () => {
  const gladys = createFakeGladys({});
  const device = buildDevice(gladys, { language: 'en' });
  assert.equal(device.external_id, 'ext:test-integration:tolo:appbox');
  assert.deepEqual(
    device.features.map((f) => f.external_id.split(':').at(-1)),
    Object.values(FEATURES),
  );
  for (const f of device.features) {
    assert.equal(parseFeatureId(gladys, f.external_id), f.external_id.split(':').at(-1));
  }
  assert.equal(parseFeatureId(gladys, 'ext:test-integration:tolo:appbox:nope'), undefined);
  assert.equal(parseFeatureId(gladys, 'ext:other:tolo:appbox:heat-on'), undefined);
  assert.equal(DEFINITIONS[FEATURES.HEATING].read_only, true);
  assert.equal(DEFINITIONS[FEATURES.HUMIDITY].unit, 'percent');
  assert.equal(DEFINITIONS[FEATURES.REMAINING].unit, 'minutes');
  assert.equal(DEFINITIONS[FEATURES.TARGET].max, 60);
});

test('states: never undefined nor NaN; off means no time left', () => {
  const states = statesOf(
    { powerOn: false, temperature: undefined, powerTimer: null, waterLevel: 9, humidity: 50 },
    { targetTemperature: undefined },
    { language: 'fr' },
  );
  for (const s of states) {
    assert.ok(s.text !== undefined || Number.isFinite(s.state), JSON.stringify(s));
  }
  assert.deepEqual(
    states.find((s) => s.role === FEATURES.REMAINING),
    { role: FEATURES.REMAINING, state: 0 },
  );
  assert.equal(
    states.find((s) => s.role === FEATURES.WATER),
    undefined,
  );
  const on = statesOf({ powerOn: true, powerTimer: null, calefaction: 3 }, undefined, {
    language: 'en',
  });
  assert.equal(
    on.find((s) => s.role === FEATURES.REMAINING),
    undefined,
    'no timer: unknown',
  );
  assert.equal(on.find((s) => s.role === FEATURES.STATUS).text, 'Keeping warm');
});

test('/data read back is repaired and bounded', () => {
  const now = 1_000_000;
  assert.deepEqual(normalizeMemory('junk', now), {
    lastAttemptAt: null,
    stopGuard: null,
    session: null,
  });
  const m = normalizeMemory(
    {
      lastAttemptAt: now + 999,
      stopGuard: { host: '192.168.1.50', until: now + 10 * 3600_000, reasserts: 99, sticky: 1 },
    },
    now,
  );
  assert.equal(m.lastAttemptAt, now);
  assert.equal(m.stopGuard.until, now + TIMINGS.guard);
  assert.equal(m.stopGuard.reasserts, TIMINGS.stopReasserts);
  assert.equal(m.stopGuard.sticky, false);
  assert.equal(
    normalizeMemory({ stopGuard: { host: '127.0.0.1', until: now + 1 } }, now).stopGuard,
    null,
  );
  assert.equal(
    normalizeMemory({ stopGuard: { host: '192.168.1.50', until: now - 1 } }, now).stopGuard,
    null,
  );
});
