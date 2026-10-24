// -----------------------------------------------------------------------------
// The real UDP transport (src/tolo/udp.js) against real sockets on the
// loopback: one socket per exchange, answers of another source or of an
// earlier exchange never taken, resends counted, sizes bounded. Real timers.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { ToloClient } from '../src/tolo/client.js';
import { COMMAND, decode } from '../src/tolo/protocol.js';
import { ERROR_KINDS } from '../src/tolo/udp.js';
import { frame } from './fixtures/fakeTolo.js';

const HOST = '127.0.0.1';
const STATUS = [0, 30, 61, 1, 0, 0, 0, 0, 3, 0, 61, 40, 30, 0, 0, 0, 0];

/** A UDP App Box on the loopback; `handle(message, rinfo, socket)` answers. */
async function server(t, handle) {
  const socket = dgram.createSocket('udp4');
  const seen = [];
  socket.on('message', (data, rinfo) => {
    const message = decode(data);
    seen.push({ message, rinfo });
    handle(message, rinfo, socket);
  });
  await new Promise((resolve) => socket.bind(0, HOST, resolve));
  t.after(() => socket.close());
  return { socket, port: socket.address().port, seen };
}

const statusAnswer = () => frame(COMMAND.GET_STATUS, 0x11, STATUS);
const opts = { attempts: 3, attemptTimeout: 150 };

test('a status read over real UDP', async (t) => {
  const box = await server(t, (m, rinfo, s) => s.send(statusAnswer(), rinfo.port, rinfo.address));
  const client = new ToloClient({ port: box.port });
  const status = await client.status(HOST, opts);
  assert.equal(status.temperature, 30);
  assert.equal(box.seen.length, 1);
});

test('an answer from another port of the same host is ignored', async (t) => {
  const intruder = dgram.createSocket('udp4');
  await new Promise((resolve) => intruder.bind(0, HOST, resolve));
  t.after(() => intruder.close());
  const box = await server(t, (m, rinfo) => {
    // Only the intruder answers: a forged status from another source port.
    intruder.send(statusAnswer(), rinfo.port, rinfo.address);
  });
  const client = new ToloClient({ port: box.port });
  await assert.rejects(client.status(HOST, opts), (err) => {
    assert.equal(err.kind, ERROR_KINDS.NO_ANSWER);
    assert.equal(err.sent, 3);
    return true;
  });
});

test('resent while silent; a malformed or oversized answer never taken', async (t) => {
  let n = 0;
  const box = await server(t, (m, rinfo, s) => {
    n += 1;
    if (n === 1) {
      return; // lost
    }
    if (n === 2) {
      s.send(Buffer.alloc(200, 0xaa), rinfo.port, rinfo.address);
      s.send(Buffer.from([0x2b]), rinfo.port, rinfo.address); // keep-alive
      return;
    }
    s.send(statusAnswer(), rinfo.port, rinfo.address);
  });
  const client = new ToloClient({ port: box.port });
  const status = await client.status(HOST, opts);
  assert.equal(status.humidity, 40);
  assert.equal(box.seen.length, 3);
});

test('a late answer of an earlier exchange never answers a later one', async (t) => {
  const pending = [];
  const box = await server(t, (m, rinfo) => pending.push({ m, rinfo }));
  const client = new ToloClient({ port: box.port });
  // A turn on that gets no answer in time.
  await assert.rejects(
    client.set(HOST, 'power', true, { attempts: 1, attemptTimeout: 100 }),
    (err) => err.kind === ERROR_KINDS.NO_ANSWER && err.sent === 1,
  );
  // A turn off: its own socket. The late "accepted" of the turn on goes to
  // the old socket (closed): the turn off never takes it for its own answer.
  const off = client.set(HOST, 'power', false, { attempts: 1, attemptTimeout: 300 });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const [on, offRequest] = pending;
  assert.equal(on.m.value, 1);
  assert.equal(offRequest.m.value, 0);
  assert.notEqual(on.rinfo.port, offRequest.rinfo.port, 'one socket per exchange');
  box.socket.send(frame(COMMAND.SET_POWER_ON, 1, [0]), on.rinfo.port, on.rinfo.address);
  await assert.rejects(off, (err) => err.kind === ERROR_KINDS.NO_ANSWER);
});

test('beforeSend runs before every datagram and stops the exchange; the count is kept', async (t) => {
  const box = await server(t, () => {});
  const client = new ToloClient({ port: box.port });
  let calls = 0;
  await assert.rejects(
    client.set(HOST, 'power', true, {
      attempts: 3,
      attemptTimeout: 50,
      beforeSend: () => {
        calls += 1;
        if (calls === 2) {
          throw new Error('a turn off arrived');
        }
      },
    }),
    (err) => err.message === 'a turn off arrived' && err.sent === 1,
  );
  assert.equal(box.seen.length, 1);
});

test('nothing sent after sendBy: "not sent"', async (t) => {
  const box = await server(t, () => {});
  const client = new ToloClient({ port: box.port });
  await assert.rejects(
    client.status(HOST, { attempts: 2, attemptTimeout: 50, sendBy: Date.now() - 1 }),
    (err) => err.kind === ERROR_KINDS.NOT_SENT && err.sent === 0,
  );
  assert.equal(box.seen.length, 0);
});
