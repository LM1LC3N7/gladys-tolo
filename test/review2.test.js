// -----------------------------------------------------------------------------
// The points of review r2: a session started from Gladys is held to its
// duration (never extended by the integration), even across a restart; side
// effects of the lamp, the fan and the setpoint.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MINUTE, SECOND } from '../src/constants.js';
import { memoryStore } from '../src/store.js';
import { COMMAND } from '../src/tolo/protocol.js';
import { NOW, fakeAppBox } from './fixtures/fakeTolo.js';
import { CFG, HEAT_CFG, setup } from './fixtures/setup.js';

const timers = (box) =>
  box
    .commands()
    .filter((c) => c.startsWith(`${COMMAND.SET_POWER_TIMER}:`))
    .map((c) => Number(c.split(':')[1]));

test('W1: a timer shown at 0 that never counts: rewritten, read strictly, turned off', async (t) => {
  const box = fakeAppBox({ timerZero: true });
  const ctx = await setup(t, { config: { ...HEAT_CFG, poll_interval: 60 }, box });
  const ack = await ctx.press('heat-on', 1, 6 * SECOND);
  assert.equal(ack.success, false);
  assert.match(String(ack.error), /minuterie non confirmée \(minuterie 0 min\)/);
  assert.equal(box.status[0], 0, 'turned off soon, not after the session');
  assert.ok(box.powerOffs().length >= 1);
  assert.match(ctx.status().message.fr, /pas tenue à sa durée/);
});

test('W1: an App Box still on after the planned end gets a dedicated read and is turned off', async (t) => {
  const box = fakeAppBox({ neverStops: true });
  const ctx = await setup(t, {
    config: { ...HEAT_CFG, session_minutes: 10, poll_interval: 3600 },
    box,
  });
  assert.equal((await ctx.press('heat-on')).success, true);
  await ctx.advance(9 * MINUTE, 1000);
  assert.equal(box.status[0], 1, 'on during the session');
  await ctx.advance(4 * MINUTE, 1000);
  assert.equal(box.status[0], 0, 'turned off after the planned end + margin');
  assert.match(ctx.status().message.fr, /encore en marche après sa fin prévue/);
});

test('W2: a timer removed at the panel is set again to what is LEFT, never extended', async (t) => {
  const box = fakeAppBox();
  const ctx = await setup(t, { config: { ...HEAT_CFG, poll_interval: 60 }, box });
  assert.equal((await ctx.press('heat-on')).success, true);
  await ctx.advance(25 * MINUTE, 1000);
  box.panelNoTimer();
  await ctx.advance(2 * MINUTE, 1000);
  const written = timers(box);
  assert.equal(written[0], 30, 'the session timer');
  assert.ok(written.length >= 2, 'set again');
  for (const minutes of written.slice(1)) {
    assert.ok(minutes <= 5, `rewrite of ${minutes} min, more than left`);
  }
  await ctx.advance(5 * MINUTE, 1000);
  assert.equal(box.status[0], 0, 'off by the planned end');
});

test('W2: a timer lengthened at the panel is cut back to what is left', async (t) => {
  const box = fakeAppBox();
  const ctx = await setup(t, { config: { ...HEAT_CFG, poll_interval: 60 }, box });
  assert.equal((await ctx.press('heat-on')).success, true);
  await ctx.advance(20 * MINUTE, 1000);
  box.settings[1] = 30;
  box.endAt = Date.now() + 30 * MINUTE; // someone sets 30 min again at the panel
  await ctx.advance(2 * MINUTE, 1000);
  assert.ok(timers(box).length >= 2, 'set again');
  assert.ok(
    timers(box)
      .slice(1)
      .every((m) => m <= 10),
  );
  await ctx.advance(10 * MINUTE, 1000);
  assert.equal(box.status[0], 0);
});

test('3: the session watch is kept in /data and survives a restart', async (t) => {
  const store = memoryStore();
  const box = fakeAppBox({ neverStops: true });
  const ctx = await setup(t, {
    config: { ...HEAT_CFG, session_minutes: 10, poll_interval: 3600 },
    box,
    store,
  });
  assert.equal((await ctx.press('heat-on')).success, true);
  await ctx.advance(SECOND);
  assert.equal(store.data.session.host, '192.168.1.50');
  assert.equal(store.data.session.minutes, 10);
  // A restart: a new app on the same /data, the session still on.
  ctx.app.stop();
  t.mock.timers.reset();
  const later = await setup(t, {
    config: { ...HEAT_CFG, session_minutes: 10, poll_interval: 3600 },
    box,
    store,
    now: Date.now(),
    create: false,
  });
  await later.advance(14 * MINUTE, 1000);
  assert.equal(box.status[0], 0, 'turned off at the planned end, after the restart');
});

test('4: lamp: the state before is a fresh read when the last one is older than 10 s', async (t) => {
  const box = fakeAppBox();
  const ctx = await setup(t, { config: { ...CFG, poll_interval: 300 }, box });
  await ctx.advance(60 * SECOND, 1000);
  box.status[0] = 1; // started at the panel since the last read
  box.endAt = Date.now() + 30 * MINUTE;
  const reads = box.reads();
  const ack = await ctx.press('lamp', 1);
  assert.equal(ack.success, true, ack.error);
  assert.ok(box.reads() > reads);
  assert.equal(box.powerOffs().length, 0, 'the session started at the panel is kept');
});

test('5: a setpoint that turns the App Box on: turned off at once, refused', async (t) => {
  const ctx = await setup(t, { config: HEAT_CFG });
  ctx.box.setpointPowersOn = true;
  const ack = await ctx.press('target-temperature', 44);
  assert.equal(ack.success, false);
  assert.match(String(ack.error), /de consigne a mis l’App Box en marche/);
  assert.equal(ctx.box.status[0], 0);
});

test('a watch restored after its end (container down then): read at the start, turned off', async (t) => {
  const store = memoryStore({
    lastAttemptAt: NOW,
    session: { host: '192.168.1.50', minutes: 30, endAt: NOW - 10 * MINUTE },
  });
  const box = fakeAppBox({ neverStops: true });
  box.status[0] = 1;
  box.status[2] = 0;
  const ctx = await setup(t, { store, box, config: { ...CFG, poll_interval: 3600 } });
  await ctx.advance(10 * SECOND);
  assert.equal(box.status[0], 0);
  assert.ok(ctx);
});
