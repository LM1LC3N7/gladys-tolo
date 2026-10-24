// -----------------------------------------------------------------------------
// The integration against the SDK's fake Gladys and a fake App Box (the real
// UDP transport over fake sockets), with a mocked clock.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { MINUTE, SECOND } from '../src/constants.js';
import { memoryStore } from '../src/store.js';
import { COMMAND } from '../src/tolo/protocol.js';
import { NOW, fakeAppBox } from './fixtures/fakeTolo.js';
import { CFG, DEVICE, HEAT_CFG, setup } from './fixtures/setup.js';

const ON = `${COMMAND.SET_POWER_ON}:1`;
const OFF = `${COMMAND.SET_POWER_ON}:0`;

test('discovery: one device, states published, heating never a switch', async (t) => {
  const ctx = await setup(t);
  const [device] = ctx.gladys.fake.discoveredDevices;
  assert.equal(device.external_id, DEVICE);
  for (const f of device.features.filter((f) => !f.read_only)) {
    const kind = `${f.category}/${f.type}`;
    assert.ok(
      ['button/push', 'thermostat/target-temperature', 'light/binary', 'switch/binary'].includes(
        kind,
      ),
      `${f.external_id} is writable as ${kind}`,
    );
  }
  const switches = device.features.filter((f) => f.category === 'switch');
  assert.deepEqual(
    switches.map((f) => f.external_id),
    [`${DEVICE}:fan`],
    'the only switch is the fan',
  );
  await ctx.advance(2 * SECOND);
  assert.equal(ctx.state('temperature').state, 22);
  assert.equal(ctx.state('humidity').state, 40);
  assert.equal(ctx.state('target-temperature').state, 45);
  assert.equal(ctx.state('heating').state, 0);
  assert.equal(ctx.state('remaining').state, 0);
  assert.equal(ctx.state('water-level').state, 100);
  assert.equal(ctx.state('tank-temperature').state, 30);
  assert.equal(ctx.state('lamp').state, 0);
  assert.equal(ctx.state('status').text, 'Éteint');
  assert.equal(ctx.status().connected, true);
  const badge = ctx.gladys.fake.transports.at(-1);
  assert.equal(badge.transport, DEVICE_TRANSPORTS.LOCAL);
  assert.deepEqual(ctx.box.commands(), [], 'reading sends no command');
});

test('turning on and the setpoint are off by default: refused, nothing sent', async (t) => {
  const ctx = await setup(t);
  let ack = await ctx.press('heat-on');
  assert.equal(ack.success, false);
  assert.match(String(ack.error), /Autoriser le chauffage/);
  ack = await ctx.press('target-temperature', 40);
  assert.equal(ack.success, false);
  assert.deepEqual(ctx.box.commands(), []);
});

test('turning on: fresh read, timer set to the session, power on, confirmed by a read', async (t) => {
  const ctx = await setup(t, { config: { ...HEAT_CFG, session_minutes: 20 } });
  const reads = ctx.box.reads();
  const ack = await ctx.press('heat-on');
  assert.equal(ack.success, true, ack.error);
  assert.ok(ctx.box.reads() > reads, 'a fresh read before');
  assert.deepEqual(ctx.box.commands(), [`${COMMAND.SET_POWER_TIMER}:20`, ON]);
  await ctx.advance(SECOND);
  assert.equal(ctx.state('heating').state, 1);
  assert.equal(ctx.state('remaining').state, 20);
  // Already on: nothing sent again.
  assert.equal((await ctx.press('heat-on')).success, true);
  assert.deepEqual(ctx.box.commands(), [`${COMMAND.SET_POWER_TIMER}:20`, ON]);
});

test('turning on lowers a setpoint above the highest one first, and always writes the timer', async (t) => {
  const box = fakeAppBox();
  box.settings[0] = 60;
  box.settings[1] = 30;
  const ctx = await setup(t, { config: { ...HEAT_CFG, max_temperature: 48 }, box });
  assert.equal((await ctx.press('heat-on')).success, true);
  assert.deepEqual(ctx.box.commands(), [
    `${COMMAND.SET_POWER_TIMER}:30`,
    `${COMMAND.SET_TARGET_TEMPERATURE}:48`,
    ON,
  ]);
});

test('turning on is refused when the timer is not read back: no power on', async (t) => {
  const ctx = await setup(t, { config: HEAT_CFG });
  ctx.box.applies = false;
  const ack = await ctx.press('heat-on');
  assert.equal(ack.success, false);
  assert.match(String(ack.error), /allumage non envoyé/);
  assert.equal(ctx.box.powerOns().length, 0);
});

test('turning on is refused unsent when the App Box is silent', async (t) => {
  const ctx = await setup(t, { config: HEAT_CFG });
  ctx.box.silent = true;
  const ack = await ctx.press('heat-on');
  assert.equal(ack.success, false);
  assert.match(String(ack.error), /allumage non envoyé/);
  assert.equal(ctx.box.powerOns().length, 0);
});

test('a power on without answer is "sent, without confirmation" and guarded', async (t) => {
  const ctx = await setup(t, { config: HEAT_CFG });
  ctx.box.settings[1] = 30;
  ctx.box.delays[COMMAND.SET_POWER_ON] = 10 * SECOND;
  const ack = await ctx.press('heat-on');
  assert.equal(ack.success, false);
  assert.match(String(ack.error), /Envoyée, sans confirmation/);
  assert.ok(ctx.box.powerOns().length >= 1);
  // A second turn on is refused while the first may land.
  const again = await ctx.press('heat-on', 1, SECOND);
  assert.equal(again.success, false);
});

test('turning off always goes: option off, before any heating, never answered "already off"', async (t) => {
  const ctx = await setup(t);
  const ack = await ctx.press('heat-off');
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(ctx.box.commands(), [OFF]);
});

test('turning off a silent App Box: resent, then "sent, without confirmation", guard kept in /data', async (t) => {
  const store = memoryStore();
  const ctx = await setup(t, { store });
  ctx.box.silent = true;
  const ack = await ctx.press('heat-off');
  assert.equal(ack.success, false);
  assert.match(String(ack.error), /Envoyée, sans confirmation/);
  assert.equal(ctx.box.powerOffs().length, 4);
  assert.equal(store.data.stopGuard.host, '192.168.1.50');
});

test('turning off is not held back by a read in progress nor an unreachable App Box', async (t) => {
  const ctx = await setup(t);
  ctx.box.delays[COMMAND.GET_STATUS] = 2_500;
  ctx.box.delays[COMMAND.GET_SETTINGS] = 2_500;
  await ctx.advance(30 * SECOND); // a poll is now in progress
  const before = ctx.box.powerOffs().length;
  ctx.fire('heat-off');
  await ctx.advance(100);
  assert.equal(ctx.box.powerOffs().length, before + 1, 'sent at once');
});

test('a turn off arriving during a turn on cancels it before its power on', async (t) => {
  const ctx = await setup(t, { config: HEAT_CFG });
  ctx.box.delays[COMMAND.GET_STATUS] = 300;
  const heat = ctx.fire('heat-on');
  await ctx.advance(100);
  const off = ctx.fire('heat-off');
  await ctx.advance(5 * SECOND);
  const ackOn = await heat;
  const ackOff = await off;
  assert.equal(ackOn.success, false);
  assert.match(String(ackOn.error), /extinction/);
  assert.equal(ackOff.success, true, ackOff.error);
  assert.equal(ctx.box.powerOns().length, 0);
});

test('a turn off overtaking a power on already sent is sent again when it settles', async (t) => {
  const ctx = await setup(t, { config: HEAT_CFG });
  ctx.box.settings[1] = 30;
  ctx.box.delays[COMMAND.SET_POWER_ON] = 1_000;
  const heat = ctx.fire('heat-on');
  for (let i = 0; i < 40 && ctx.box.powerOns().length === 0; i += 1) {
    await ctx.advance(10, 10);
  }
  assert.equal(ctx.box.powerOns().length, 1);
  ctx.box.delays[COMMAND.SET_POWER_ON] = 0;
  const off = ctx.fire('heat-off');
  await ctx.advance(8 * SECOND);
  await heat;
  await off;
  assert.ok(ctx.box.powerOffs().length >= 2, 'sent again after the power on settled');
  // The guard refuses a new turn on for now.
  const again = await ctx.press('heat-on');
  assert.equal(again.success, false);
  assert.match(String(again.error), /extinction est en cours/);
});

test('the reads reaffirm a turn off (3 times at most) while its guard lasts', async (t) => {
  const ctx = await setup(t, { config: { ...CFG, poll_interval: 10 } });
  ctx.box.silent = true;
  await ctx.press('heat-off');
  ctx.box.silent = false;
  ctx.box.status[0] = 1; // someone turned it on meanwhile
  ctx.box.applies = false; // and it stays on
  const offs = ctx.box.powerOffs().length;
  await ctx.advance(110 * SECOND, 200);
  const sent = ctx.box.powerOffs().length - offs;
  assert.equal(sent, 3, 'reaffirmed three times');
  const later = ctx.box.powerOffs().length;
  await ctx.advance(3 * MINUTE, 500);
  assert.equal(ctx.box.powerOffs().length, later, 'not after the guard');
});

test('a guard kept in /data survives a restart and reaffirms the turn off', async (t) => {
  const store = memoryStore({
    lastAttemptAt: NOW - 10 * MINUTE,
    stopGuard: { host: '192.168.1.50', until: NOW + MINUTE, reasserts: 0, sticky: true },
  });
  const box = fakeAppBox();
  box.status[0] = 1;
  box.applies = false;
  const ctx = await setup(t, { store, box });
  await ctx.advance(5 * SECOND);
  assert.ok(ctx.box.powerOffs().length >= 1);
});

test('the setpoint: bounded by the configuration, confirmed by the settings', async (t) => {
  const ctx = await setup(t, { config: { ...HEAT_CFG, max_temperature: 50 } });
  for (const bad of [51, 34, 45.5, '', null, '45°', true]) {
    const ack = await ctx.press('target-temperature', bad, SECOND);
    assert.equal(ack.success, false, String(bad));
    assert.match(String(ack.error), /nombre entier de 35 à 50/);
  }
  assert.deepEqual(ctx.box.commands(), []);
  const ack = await ctx.press('target-temperature', '48');
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(ctx.box.commands(), [`${COMMAND.SET_TARGET_TEMPERATURE}:48`]);
  assert.equal(ctx.state('target-temperature').state, 48);
});

test('lamp and fan: plain on/off, confirmed by a read; values checked', async (t) => {
  const ctx = await setup(t);
  assert.equal((await ctx.press('lamp', 1)).success, true);
  assert.equal((await ctx.press('fan', '1')).success, true);
  assert.equal((await ctx.press('fan', 0)).success, true);
  for (const bad of [2, '', null, true, 'on']) {
    assert.equal((await ctx.press('lamp', bad, SECOND)).success, false, String(bad));
  }
  assert.deepEqual(ctx.box.commands(), [
    `${COMMAND.SET_LAMP_ON}:1`,
    `${COMMAND.SET_FAN_ON}:1`,
    `${COMMAND.SET_FAN_ON}:0`,
  ]);
  ctx.box.applies = false;
  const ack = await ctx.press('lamp', 0);
  assert.match(String(ack.error), /sans confirmation/);
});

test('a command the App Box refuses is said refused', async (t) => {
  const ctx = await setup(t);
  ctx.box.refuse.add(COMMAND.SET_LAMP_ON);
  const ack = await ctx.press('lamp', 1);
  assert.match(String(ack.error), /a refusé/);
});

test('read only features and other devices are refused', async (t) => {
  const ctx = await setup(t);
  assert.equal((await ctx.press('temperature', 1)).success, false);
  const ack = await ctx.gladys.fake.setValue(
    { external_id: 'ext:test-integration:tolo:other' },
    { external_id: 'ext:test-integration:tolo:other:heat-off' },
    1,
  );
  assert.equal(ack.success, false);
  assert.deepEqual(ctx.box.commands(), []);
});

test('answers from another port, malformed or from another address are ignored', async (t) => {
  const box = fakeAppBox({ junkFirst: true });
  const ctx = await setup(t, { box });
  assert.equal(ctx.status().connected, true, 'the real answer is still taken');
});

test('an answer from another address is never taken', async (t) => {
  const ctx = await setup(t, { box: fakeAppBox({ answerFrom: '192.168.1.51' }) });
  assert.equal(ctx.status().connected, false);
  assert.match(ctx.status().message.fr, /ne répond pas/);
  assert.equal(ctx.gladys.fake.discoveredDevices.length, 0);
});

test('an unreachable App Box: status, badge, backoff; turning off still sent', async (t) => {
  const ctx = await setup(t);
  ctx.box.silent = true;
  await ctx.advance(40 * SECOND);
  assert.equal(ctx.status().connected, false);
  assert.equal(ctx.gladys.fake.transports.at(-1).transport, DEVICE_TRANSPORTS.UNREACHABLE);
  const offs = ctx.box.powerOffs().length;
  ctx.fire('heat-off');
  await ctx.advance(200);
  assert.equal(ctx.box.powerOffs().length, offs + 1);
});

test('never read sooner than the interval after the last read, even after a restart', async (t) => {
  const store = memoryStore({ lastAttemptAt: NOW - 10 * SECOND });
  const box = fakeAppBox();
  const ctx = await setup(t, { store, box, create: false });
  assert.equal(box.reads(), 0, 'no read at the start');
  await ctx.advance(15 * SECOND);
  assert.equal(box.reads(), 0, 'not within the interval');
  // /data keeps the time within a minute: the wait may end up to the full interval from now.
  await ctx.advance(20 * SECOND);
  assert.ok(box.reads() >= 1);
  // The test button within the interval shows the last read.
  const reads = box.reads();
  await ctx.app.testConnection();
  assert.equal(box.reads(), reads);
});

test('no address, or an invalid one: a clear status, nothing sent', async (t) => {
  const ctx = await setup(t, { config: { host: '192.168.1.255' } });
  assert.equal(ctx.status().connected, false);
  assert.match(ctx.status().message.fr, /pas valide/);
  assert.equal(ctx.box.log.length, 0);
});
