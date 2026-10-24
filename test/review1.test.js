// -----------------------------------------------------------------------------
// The points of review r1, against the fake App Box (and real loopback
// sockets for the transport).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { MINUTE, SECOND } from '../src/constants.js';
import { memoryStore } from '../src/store.js';
import { ToloClient } from '../src/tolo/client.js';
import { COMMAND } from '../src/tolo/protocol.js';
import { ERROR_KINDS } from '../src/tolo/udp.js';
import { NOW, fakeAppBox } from './fixtures/fakeTolo.js';
import { CFG, DEVICE, HEAT_CFG, setup } from './fixtures/setup.js';

const LAMP_ON = `${COMMAND.SET_LAMP_ON}:1`;

test('1. a turn on whose session runs without a timer: not a success, timer set again, then turned off', async (t) => {
  const box = fakeAppBox({ timerIgnored: true });
  const ctx = await setup(t, { config: HEAT_CFG, box });
  const ack = await ctx.press('heat-on', 1, 6 * SECOND);
  assert.equal(ack.success, false);
  assert.match(String(ack.error), /minuterie non confirmée/);
  // In the background: the timer written again, read, still none: turned off.
  assert.ok(box.commands().filter((c) => c === `${COMMAND.SET_POWER_TIMER}:30`).length >= 2);
  assert.ok(box.powerOffs().length >= 1, 'turned off');
  assert.equal(box.status[0], 0);
  assert.match(ctx.status().message.fr, /sans minuterie confirmée/);
});

test('1. a turn on with a bounding timer is confirmed', async (t) => {
  const ctx = await setup(t, { config: { ...HEAT_CFG, session_minutes: 25 } });
  const ack = await ctx.press('heat-on');
  assert.equal(ack.success, true, ack.error);
  assert.equal(ctx.state('remaining').state, 25);
});

test('1. a later read showing the timer gone during a Gladys session: set again, then off', async (t) => {
  const ctx = await setup(t, { config: { ...HEAT_CFG, poll_interval: 10 } });
  assert.equal((await ctx.press('heat-on')).success, true);
  // Someone removes the timer on the App Box, and it ignores new ones.
  ctx.box.timerIgnored = true;
  ctx.box.status[2] = 61;
  await ctx.advance(30 * SECOND, 100);
  assert.ok(ctx.box.powerOffs().length >= 1);
});

test('1. a session started elsewhere without a timer is not watched', async (t) => {
  const box = fakeAppBox();
  box.status[0] = 1; // on, no timer (61), started from the TOLO app
  const ctx = await setup(t, { box, config: { ...CFG, poll_interval: 10 } });
  await ctx.advance(30 * SECOND, 100);
  assert.equal(ctx.box.powerOffs().length, 0);
  assert.equal(ctx.state('heating').state, 1);
});

test('2. turn off: any value presses it', async (t) => {
  const ctx = await setup(t);
  for (const value of [0, true, 'on', 2, null]) {
    const ack = await ctx.press('heat-off', value, SECOND);
    assert.equal(ack.success, true, `${value}: ${ack.error}`);
  }
  assert.equal(ctx.box.powerOffs().length, 5);
  // Turn on stays strict.
  const on = await ctx.press('heat-on', true, SECOND);
  assert.match(String(on.error), /ne prend que 1/);
});

test('3. an ICMP error ends an attempt only: the turn off is resent 4 times', async (t) => {
  const ctx = await setup(t);
  ctx.box.icmp = true;
  const ack = await ctx.press('heat-off');
  assert.equal(ack.success, false);
  assert.match(String(ack.error), /Envoyée, sans confirmation/);
  assert.equal(ctx.box.powerOffs().length, 4);
});

test('3. a closed port on real sockets: 4 datagrams, one fresh socket each', async () => {
  const probe = dgram.createSocket('udp4');
  await new Promise((resolve) => probe.bind(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve)); // now closed: ICMP port unreachable
  let created = 0;
  const { udpTransport } = await import('../src/tolo/udp.js');
  const client = new ToloClient({
    port,
    transport: udpTransport({
      createSocket: () => {
        created += 1;
        return dgram.createSocket('udp4');
      },
    }),
  });
  const started = Date.now();
  await assert.rejects(
    client.set('127.0.0.1', 'power', false, { attempts: 4, attemptTimeout: 100 }),
    (err) => err.kind === ERROR_KINDS.NO_ANSWER && err.sent === 4,
  );
  assert.equal(created, 4);
  assert.ok(Date.now() - started >= 300, 'spaced, not 1 datagram in 3 ms');
});

test('4. a turn on answered "refused" but applied: judged on the read', async (t) => {
  const ctx = await setup(t, { config: HEAT_CFG });
  ctx.box.refuseApplied.add(COMMAND.SET_POWER_ON);
  const ack = await ctx.press('heat-on');
  assert.equal(ack.success, false);
  assert.match(String(ack.error), /répondu par un refus, mais indique : En chauffe/);
});

test('4. a turn on refused and read off: refused', async (t) => {
  const box = fakeAppBox();
  box.refuse.add(COMMAND.SET_POWER_ON);
  const ctx = await setup(t, { config: HEAT_CFG, box });
  const ack = await ctx.press('heat-on');
  assert.match(String(ack.error), /a refusé/);
});

test('4. a turn off answered "refused": off as read is a success, on keeps the guard', async (t) => {
  const store = memoryStore();
  const box = fakeAppBox();
  box.refuseApplied.add(COMMAND.SET_POWER_ON);
  const ctx = await setup(t, { box, store });
  assert.equal((await ctx.press('heat-off')).success, true);
  assert.equal(store.data?.stopGuard ?? null, null);
  box.refuseApplied.clear();
  box.refuse.add(COMMAND.SET_POWER_ON);
  box.status[0] = 1;
  const ack = await ctx.press('heat-off');
  assert.match(String(ack.error), /répondu par un refus/);
  assert.ok(store.data.stopGuard);
});

test('5. a lamp command that turns the App Box on: turned off at once, refused', async (t) => {
  const ctx = await setup(t);
  ctx.box.lampPowersOn = true;
  const ack = await ctx.press('lamp', 1);
  assert.equal(ack.success, false);
  assert.match(String(ack.error), /lampe a mis l’App Box en marche/);
  assert.deepEqual(ctx.box.commands().slice(0, 2), [LAMP_ON, `${COMMAND.SET_POWER_ON}:0`]);
  assert.equal(ctx.box.status[0], 0);
});

test('7. a guard restored from /data gets a read 5 s after the start, long interval or not', async (t) => {
  const store = memoryStore({
    lastAttemptAt: NOW,
    stopGuard: { host: '192.168.1.50', until: NOW + 2 * MINUTE, reasserts: 0, sticky: true },
  });
  const box = fakeAppBox();
  box.status[0] = 1;
  box.applies = false;
  const ctx = await setup(t, { store, box, config: { ...CFG, poll_interval: 300 } });
  await ctx.advance(6 * SECOND);
  assert.ok(box.reads() >= 1, 'a guard read');
  assert.ok(box.powerOffs().length >= 1, 'the turn off reaffirmed');
});

test('8. during a turn off guard, only a lower setpoint is accepted', async (t) => {
  const ctx = await setup(t, { config: HEAT_CFG });
  ctx.box.silent = true;
  await ctx.press('heat-off');
  ctx.box.silent = false;
  let ack = await ctx.press('target-temperature', 50);
  assert.match(String(ack.error), /seule une consigne plus basse/);
  ack = await ctx.press('target-temperature', 40);
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(
    ctx.box.commands().filter((c) => c.startsWith(`${COMMAND.SET_TARGET_TEMPERATURE}:`)),
    [`${COMMAND.SET_TARGET_TEMPERATURE}:40`],
  );
});

test('9. a turn off before the configuration is loaded uses the SDK cache', async (t) => {
  const ctx = await setup(t);
  // As right after a start: the configuration of the app is not loaded yet.
  ctx.app.config = { ...ctx.app.config, host: undefined };
  const pending = ctx.gladys.fake.setValue(
    { external_id: DEVICE },
    { external_id: `${DEVICE}:heat-off` },
    1,
  );
  await ctx.advance(SECOND);
  const ack = await pending;
  assert.equal(ack.success, true, ack.error);
  assert.equal(ctx.box.powerOffs().length, 1);
});

test('13. a turn on confirmed after a turn off arrived meanwhile is not a success', async (t) => {
  const ctx = await setup(t, { config: HEAT_CFG });
  ctx.box.delays[COMMAND.SET_POWER_ON] = 300;
  const heat = ctx.fire('heat-on');
  for (let i = 0; i < 60 && ctx.box.powerOns().length === 0; i += 1) {
    await ctx.advance(10, 10);
  }
  ctx.box.delays[COMMAND.SET_POWER_ON] = 600; // the turn off lands after
  const off = ctx.fire('heat-off');
  await ctx.advance(8 * SECOND);
  const ack = await heat;
  await off;
  assert.equal(ack.success, false);
  assert.ok(ctx.box.powerOffs().length >= 1);
});
