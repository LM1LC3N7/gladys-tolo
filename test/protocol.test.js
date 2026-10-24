// -----------------------------------------------------------------------------
// The App Box protocol (src/tolo/protocol.js): frames as tololib builds them,
// strict parsing of hostile datagrams.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMMAND,
  MAX_DATAGRAM,
  REQUESTS,
  decode,
  encode,
  isKeepAlive,
  parseSetAnswer,
  parseSettings,
  parseStatus,
  waterPercent,
} from '../src/tolo/protocol.js';
import { frame } from './fixtures/fakeTolo.js';

test('requests are the bytes of tololib', () => {
  // Message(Command.GET_STATUS, b"\x11", b"\xff").to_bytes()
  assert.equal(REQUESTS.status().toString('hex'), 'aaaa6111ff55558f');
  assert.equal(REQUESTS.settings().toString('hex'), 'aaaa6308ff555594');
  assert.equal(REQUESTS.powerOn(true).toString('hex'), 'aaaa0e01ff5555f0');
  assert.equal(REQUESTS.powerOn(false).toString('hex'), 'aaaa0e00ff5555f1');
  for (const request of [REQUESTS.status(), REQUESTS.powerTimer(30), REQUESTS.lampOn(true)]) {
    assert.equal(request.length, 8);
    assert.ok(decode(request));
  }
});

test('setpoint and timer are bounded; never "no timer"', () => {
  assert.equal(REQUESTS.targetTemperature(35)[3], 35);
  assert.equal(REQUESTS.targetTemperature(60)[3], 60);
  for (const bad of [34, 61, 45.5, NaN, '45', null]) {
    assert.throws(() => REQUESTS.targetTemperature(bad), RangeError, String(bad));
  }
  assert.equal(REQUESTS.powerTimer(1)[3], 1);
  assert.equal(REQUESTS.powerTimer(60)[3], 60);
  for (const bad of [0, 61, 255, null, undefined, 1.5]) {
    assert.throws(() => REQUESTS.powerTimer(bad), RangeError, String(bad));
  }
  assert.throws(() => encode(0x42, 0), RangeError, 'a command this integration never sends');
});

test('decode refuses bad prefix, suffix, checksum, sizes', () => {
  const good = frame(COMMAND.SET_LAMP_ON, 1, [0]);
  assert.ok(decode(good));
  const flip = (i) => {
    const b = Buffer.from(good);
    b[i] ^= 0x01;
    return b;
  };
  for (const i of [0, 1, good.length - 3, good.length - 2, good.length - 1, 2]) {
    assert.equal(decode(flip(i)), undefined, `byte ${i}`);
  }
  assert.equal(decode(Buffer.alloc(0)), undefined);
  assert.equal(decode(Buffer.from([0xaa, 0xaa, 0x55, 0x55])), undefined);
  assert.equal(decode(frame(1, 1, new Array(MAX_DATAGRAM).fill(0))), undefined, 'too long');
  assert.equal(decode('aaaa'), undefined);
  assert.ok(isKeepAlive(Buffer.from([0x2b])));
  assert.ok(!isKeepAlive(Buffer.from([0x2b, 0x2b])));
});

const STATUS = [1, 47, 25, 64 | 16 | 0, 0, 0, 0, 1, 2, 0, 61, 88, 52, 0, 0, 0, 0];

test('the status: every field, timers, unknown values left undefined', () => {
  const s = parseStatus(decode(frame(COMMAND.GET_STATUS, 0x11, STATUS)));
  assert.equal(s.powerOn, true);
  assert.equal(s.temperature, 47);
  assert.equal(s.powerTimer, 25);
  assert.equal(s.calefaction, 0);
  assert.equal(s.flowIn, true);
  assert.equal(s.flowOut, true);
  assert.equal(s.lampOn, true);
  assert.equal(s.waterLevel, 2);
  assert.equal(waterPercent(s.waterLevel), 66);
  assert.equal(s.fanOn, false);
  assert.equal(s.fanTimer, null);
  assert.equal(s.humidity, 88);
  assert.equal(s.tankTemperature, 52);
  const odd = [...STATUS];
  odd[0] = 7;
  odd[2] = 61;
  odd[8] = 9;
  odd[11] = 140;
  const o = parseStatus(decode(frame(COMMAND.GET_STATUS, 0x11, odd)));
  assert.equal(o.powerOn, undefined, 'a power byte other than 0/1 is unknown');
  assert.equal(o.powerTimer, null);
  assert.equal(o.waterLevel, undefined);
  assert.equal(waterPercent(o.waterLevel), undefined);
  assert.equal(o.humidity, undefined);
});

test('the status is refused with another command, value or length', () => {
  assert.equal(parseStatus(decode(frame(COMMAND.GET_SETTINGS, 0x11, STATUS))), undefined);
  assert.equal(parseStatus(decode(frame(COMMAND.GET_STATUS, 0x10, STATUS))), undefined);
  assert.equal(parseStatus(decode(frame(COMMAND.GET_STATUS, 0x11, STATUS.slice(1)))), undefined);
  assert.equal(parseStatus(decode(frame(COMMAND.GET_STATUS, 0x11, [...STATUS, 0]))), undefined);
  assert.equal(parseStatus(undefined), undefined);
});

test('the settings: setpoint within the App Box range, timer, 7 or 8 bytes', () => {
  const s = parseSettings(
    decode(frame(COMMAND.GET_SETTINGS, 0x08, [45, 30, 0, 0, 61, 95, 255, 0])),
  );
  assert.deepEqual(s, { targetTemperature: 45, powerTimer: 30, targetHumidity: 95 });
  const none = parseSettings(decode(frame(COMMAND.GET_SETTINGS, 0x08, [70, 255, 0, 0, 61, 95, 0])));
  assert.deepEqual(none, { targetTemperature: undefined, powerTimer: null, targetHumidity: 95 });
  const zero = parseSettings(
    decode(frame(COMMAND.GET_SETTINGS, 0x08, [45, 0, 0, 0, 61, 95, 0, 0])),
  );
  assert.equal(zero.powerTimer, undefined, 'a timer of 0 is unknown, never "no timer"');
  assert.equal(parseSettings(decode(frame(COMMAND.GET_SETTINGS, 0x08, [45]))), undefined);
  assert.equal(
    parseSettings(decode(frame(COMMAND.GET_STATUS, 0x08, STATUS.slice(0, 8)))),
    undefined,
  );
});

test('a set answer: only of the same command; 00 accepted, anything else refused', () => {
  const code = COMMAND.SET_POWER_ON;
  assert.equal(parseSetAnswer(decode(frame(code, 0, [0])), code), true);
  assert.equal(parseSetAnswer(decode(frame(code, 0, [1])), code), false);
  assert.equal(parseSetAnswer(decode(frame(code, 0, [0, 0])), code), false);
  assert.equal(parseSetAnswer(decode(frame(COMMAND.SET_LAMP_ON, 0, [0])), code), undefined);
});
