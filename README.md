# gladys-tolo

[Gladys Assistant](https://gladysassistant.com) external integration for
**TOLO steam generators and saunas with their App Box**, on the local network
(UDP port 51500, no account, no cloud): status, temperature, humidity,
setpoint, time left, water level, tank temperature, lamp, fan; turn off never
held back; turning on and the setpoint behind an off-by-default option, every
turn on with a bounded timer. **Never tested with a real device. Not
affiliated with TOLO.**

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

## How it works

```
Gladys ⇄ SDK ⇄ src/handlers.js ⇄ src/app.js (ToloApp)
                                  ├─ src/tolo/client.js    status, settings, sets
                                  ├─ src/tolo/protocol.js  frames and parsing (pure, strict)
                                  ├─ src/tolo/udp.js       the only network access: one socket per exchange
                                  ├─ src/devices.js        the device and its states (pure)
                                  ├─ src/publisher.js      states within 300/min
                                  └─ src/store.js          /data/tolo-state.json (no secret)
```

- **Protocol**: not documented by TOLO; ported from `tololib` 1.2.2 (MIT,
  Matthias Lohr, the library of Home Assistant's TOLO integration).
  `AA AA | command | value | extra | 55 55 | XOR`, port 51500; status (97),
  settings (99), sets of power (14), timer (8), setpoint (4), lamp (30), fan
  (34). Nothing else is ever sent.
- **Answers**: every exchange has its own UDP socket, connected to the App
  Box: a late answer of an earlier exchange reaches a closed socket. Source
  address and port checked again, datagram size bounded (64 bytes), prefix,
  suffix, checksum, command, value and length checked; anything else is
  ignored and counted. A set answer must echo the value sent. Silent, or a
  socket error (ICMP): sent again from a fresh socket (reads 3 × 1 s;
  commands 2 × 400 ms; turn off 4 × 400 ms).
- **Identity**: one device, `tolo:appbox` (frozen): the protocol has no serial
  number nor MAC. The address is a unicast IPv4 address typed by the user
  (no broadcast, multicast, loopback, link-local nor .255).
- **Reads**: every 30 s (10 s – 1 h); periodic reads never sooner than the
  interval after the last one (a command adds its own reads; a turn off
  guard restored from `/data` gets one read 5 s after the start) (time kept in `/data`, written before the read, at most once a
  minute). Failures retried after 30 s, 1, 2, 5 min. A read begun before a
  command left, or for an old configuration, is not applied.
- **Commands**: heating has no switch. "Turn off" (a button) is never held
  back: no option, no queue, no read before it; it cancels a turn on not
  sent yet, is sent again after one in flight, and is reaffirmed (3 times at
  most) by the reads of the next 2 min if the App Box is on again (guard kept
  in `/data`). "Turn on" (a button) and the setpoint
  (`thermostat/target-temperature`) are behind `allow_heating` (off), checked
  again right before every datagram; turning on is decided on a fresh read of
  the status and the settings, first sets the timer to `session_minutes`
  (never "no timer") and lowers a setpoint above `max_temperature`, both read
  back, leaves within 3.5 s or is refused unsent, one at a time, confirmed
  only by a read showing the power on; else "sent, without confirmation".
  A turn on is confirmed only when the read shows a timer of at most the
  session duration; a session from Gladys found without it (then, or later)
  gets the timer again, then is turned off. Any answer, "refused" included,
  is judged on a read. Lamp (`light/binary`) and fan (`switch/binary`):
  plain sets, confirmed by a read; according to tololib they only drive
  their output, and should one turn the App Box on, it is turned off at
  once.

## Development

```bash
npm install
npm run format:check && npm run lint && npm test
npm run audit
npm run cover          # cover.png, plain Node
npx github:GladysAssistant/integration-store .
```

Tests use the SDK's fake Gladys and a fake App Box behind fake sockets
(`test/fixtures`), running the real transport with a mocked clock; the UDP
layer is also tested against real sockets on the loopback
(`test/udp.test.js`).

## Credits and license

Apache-2.0 (see `LICENSE`). The protocol code is a JavaScript port of parts
of the `tololib` Python library (MIT, Matthias Lohr): see
`THIRD_PARTY_NOTICES.md`.
