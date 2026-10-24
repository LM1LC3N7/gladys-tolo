// -----------------------------------------------------------------------------
// A fake App Box behind fake UDP sockets, so the tests run the real transport
// (src/tolo/udp.js: one socket per exchange, resends, deadlines, source and
// shape checks) without the network. The App Box answers like the device
// simulator of tololib (device_simulator.py: a set answered with the same
// command, its value and the extra byte 00; status and settings as stored).
// Values are made up, never captured from a real device. Delays use
// setTimeout, so the mocked clock drives them.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import { COMMAND, decode } from '../../src/tolo/protocol.js';
import { udpTransport } from '../../src/tolo/udp.js';

export const HOST = '192.168.1.50';
export const PORT = 51500;
export const NOW = Date.UTC(2026, 9, 24, 18, 0, 0);

/** Lets pending promises run. */
export async function settle(rounds = 20) {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

const xor = (bytes) => bytes.reduce((crc, b) => crc ^ b, 0);

/** One message as the App Box sends it. */
export function frame(code, value, extra) {
  const body = [0xaa, 0xaa, code, value, ...extra, 0x55, 0x55];
  return Buffer.from([...body, xor(body)]);
}

/**
 * The App Box. The test may set: `silent` (receives, never answers),
 * `drop` (the next N datagrams are lost), `delay` (ms before an answer),
 * `delays` (ms, by command code), `refuse` (command codes answered 01),
 * `applies` (false: sets are acked but change nothing), `down` (sending
 * fails: EHOSTUNREACH), `junkFirst` (before each answer, a datagram from
 * another port and a malformed one), `answerFrom` (another source address).
 */
export function fakeAppBox(over = {}) {
  const status = Buffer.alloc(17);
  status[1] = 22; // temperature
  status[2] = 61; // no timer running
  status[3] = 1; // calefaction inactive
  status[8] = 3; // water level full
  status[10] = 61;
  status[11] = 40; // humidity
  status[12] = 30; // tank temperature
  const settings = Buffer.from([45, 0xff, 0, 0, 61, 95, 0xff, 0]);
  const box = {
    status,
    settings,
    silent: false,
    drop: 0,
    delay: 2,
    delays: {},
    refuse: new Set(),
    applies: true,
    down: false,
    junkFirst: false,
    answerFrom: undefined,
    /** Every datagram received: { code, value, at }. */
    log: [],
    sockets: 0,
    ...over,
  };
  box.commands = () =>
    box.log
      .filter((m) => m.code !== COMMAND.GET_STATUS && m.code !== COMMAND.GET_SETTINGS)
      .map((m) => `${m.code}:${m.value}`);
  box.reads = () => box.log.filter((m) => m.code === COMMAND.GET_STATUS).length;
  box.powerOns = () => box.log.filter((m) => m.code === COMMAND.SET_POWER_ON && m.value === 1);
  box.powerOffs = () => box.log.filter((m) => m.code === COMMAND.SET_POWER_ON && m.value === 0);

  const apply = (code, value) => {
    if (!box.applies) {
      return;
    }
    switch (code) {
      case COMMAND.SET_POWER_ON:
        status[0] = value;
        status[3] = (status[3] & ~3) | (value ? 0 : 1);
        if (value) {
          status[2] = settings[1] === 0xff ? 61 : settings[1];
        } else {
          status[2] = 61;
        }
        break;
      case COMMAND.SET_POWER_TIMER:
        settings[1] = value;
        break;
      case COMMAND.SET_TARGET_TEMPERATURE:
        settings[0] = value;
        break;
      case COMMAND.SET_LAMP_ON:
        status[7] = value;
        break;
      case COMMAND.SET_FAN_ON:
        status[9] = value;
        break;
      default:
    }
  };

  const answer = (message) => {
    if (message.code === COMMAND.GET_STATUS) {
      return frame(message.code, 0x11, [...status]);
    }
    if (message.code === COMMAND.GET_SETTINGS) {
      return frame(message.code, 0x08, [...settings]);
    }
    if (box.refuse.has(message.code)) {
      return frame(message.code, message.value, [0x01]);
    }
    apply(message.code, message.value);
    return frame(message.code, message.value, [0x00]);
  };

  /** A fake dgram socket: connect, send, message events, close. */
  box.createSocket = () => {
    box.sockets += 1;
    const socket = new EventEmitter();
    let peer;
    let closed = false;
    socket.connect = (port, host, cb) => {
      peer = { address: host, port };
      Promise.resolve().then(() => cb());
    };
    socket.close = () => {
      closed = true;
    };
    const deliver = (data, rinfo) => {
      if (!closed) {
        socket.emit('message', data, rinfo);
      }
    };
    socket.send = (data, cb) => {
      if (box.down) {
        Promise.resolve().then(() =>
          cb(Object.assign(new Error('unreachable'), { code: 'EHOSTUNREACH' })),
        );
        return;
      }
      Promise.resolve().then(() => cb(null));
      const message = decode(data);
      if (!message || peer.address !== box.host || peer.port !== PORT) {
        return;
      }
      box.log.push({ code: message.code, value: message.value, at: Date.now() });
      if (box.drop > 0) {
        box.drop -= 1;
        return;
      }
      if (box.silent) {
        return;
      }
      const wait = box.delays[message.code] ?? box.delay;
      setTimeout(() => {
        const reply = answer(message);
        if (box.junkFirst) {
          deliver(reply, { address: box.host, port: PORT + 1 });
          deliver(Buffer.from([0xaa, 0xaa, message.code, 0, 0, 0x55, 0x55, 0]), {
            address: box.host,
            port: PORT,
          });
        }
        deliver(reply, { address: box.answerFrom ?? box.host, port: PORT });
      }, wait);
    };
    return socket;
  };
  box.host = over.host ?? HOST;
  box.transport = udpTransport({ createSocket: box.createSocket });
  return box;
}
