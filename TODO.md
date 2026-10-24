# TODO — TOLO v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`
  (Node 22 and 24), `npm run audit`, `npx github:GladysAssistant/integration-store .`,
  then update README, `docs/en.md`, `docs/fr.md`, `CHANGELOG.md` and this file.
- No forum topic of its own, no forum post from a module session: the batch
  reserved in /t/10385 (lot 15) gets one recap message there.
- The `gladys-assistant-integration` topic is added at the first real release only.

## Status

- [x] **Milestone 1 — core** (2026-10-24): one App Box at a typed IPv4
      address, UDP on port 51500 (one socket per exchange), status and
      settings read every interval (never sooner, even after a restart);
      heating, status, temperature, humidity, setpoint, time left, water
      level, tank temperature, lamp and fan; turn off never held back, sent
      again while silent, reaffirmed for 2 min (guard in /data); turn on and
      setpoint behind `allow_heating` (off), turn on decided on a fresh read,
      timer and setpoint set and read back first; test button; docs en/fr;
      cover. Tested against a fake App Box only (and real loopback sockets
      for the transport).
- [ ] **Milestone 2 — real App Box**: run against a real App Box (see "To
      check"), turn the frames (anonymized) into fixtures.
- [ ] **Milestone 3 — more**: discovery through the core
      (`network_discovery` `udp-active-broadcast` on port 51500, tololib's
      `discover` message), humidity setpoint, aroma therapy, salt bath,
      sweep and fan timers (pumps and valves: behind options), scene trigger
      "ready" (temperature reached).

## To check on a real App Box

- Whether a set is answered with its own value echoed (as tololib's
  simulator does): the code only needs the command and the extra byte 00,
  the value is not used.
- Whether the power timer set before the power on is the one the session
  uses (status byte 2 counting down), and what status byte 2 shows while
  off.
- Whether a status read right after a set already shows its effect (else
  every command is "sent, without confirmation" and the follow-up reads
  show it).
- The settings answer length (7 or 8 bytes) and the keep-alive byte.
- Whether the App Box answers from port 51500 to the source port of the
  request (tololib assumes it).

## Decisions

- **Version 0.1.0 set by hand** in `package.json`, `package-lock.json`, the
  manifest and `docker_image` (`ghcr.io/lm1lc3n7/gladys-tolo:0.1.0`); the
  first patch release gives 0.1.1.
- **Reference**: tololib 1.2.2 (MIT, LICENSE.md read: Copyright (c)
  2021-2024 Matthias Lohr), gitlab.com/MatthiasLohr/tololib, cloned read only
  in `~/code/ref/lot15/tololib` (commit e5bf3c7, 2026-10-20). Credited in
  `THIRD_PARTY_NOTICES.md`, copied into the image. No key, no app identity in
  the library or here.
- **Neighbours followed**: LM1LC3N7/gladys-huum (sauna: heating behind an
  option, two buttons, setpoint, turn off outside any queue, reaffirmation,
  generation, read spacing in /data). gladys-saunum (same lot) was being
  written at the same time: not waited for.
- **Identity**: one device, FROZEN RULE `gladys.externalIds('tolo',
'appbox')`. The protocol gives no serial number nor MAC, so there is
  nothing to verify before a command: the App Box is "the one answering at
  the configured address" (docs ask for a fixed DHCP lease). A new address
  keeps the device and its history.
- **UDP, one socket per exchange**: attribution of answers by the socket
  (the kernel filters other sources of a connected socket; checked again in
  code); never a shared socket. A set answer is accepted on its command code
  and the extra byte 00 (refused otherwise); its value is not compared (the
  real App Box's echo is unknown): the confirmation is always a read after.
- **Retries**: reads 3 × 1 s (polling), 2 × 400 ms (commands); sets are
  idempotent (power on/off, values), so resending one on silence is safe;
  every resend of a power on passes the option, turn off and deadline
  checks again.
- **Turning on** (`allow_heating`, off): decided on a fresh read of status
  and settings. Before the power on, the timer is set to `session_minutes`
  (30 by default, 1 to 60, the App Box limit; never "no timer") and a stored
  setpoint above `max_temperature` (50 by default, 35 to 60, the App Box
  range) is lowered to it; both are read back, else the turn on is refused
  ("heating not sent": the timer may have been written, which heats
  nothing). The deadlines: reads by 1.5 s, writes by 2.4 s, their read back
  by 3.2 s, power on by 3.5 s, answers by 4.3 s.
- **Setpoint** behind the same option although it does not power on (it
  raises the heat of a running session), capped by `max_temperature`.
- **Turning off** decides nothing: always sent, 4 datagrams at most while
  silent, outside any queue (its own socket). Confirmed only by a read
  showing the power off with no turn on that may land. A guard of 2 min
  otherwise: reads that see the power on send it again (3 times at most).
  A turn on that left before the turn off makes the guard sticky (lifted by
  time only). The guard is kept in /data with the address (lesson 17 of
  lot 14), restored after a restart for the same address only. In memory,
  guards and deadlines use the monotonic clock; /data uses the wall clock.
- **Lamp and fan** as `light/binary` and `switch/binary`: an "everything
  on/off" may reach them, which heats nothing (the fan of a steam room
  vents). One command at a time per role.
- **No door sensor** on TOLO: nothing like Huum's door check; the docs warn.
- **Not read**: aroma therapy, sweep, salt bath, flow in/out, fan timer,
  target humidity (read, not published), model.
- **No discovery in v1**: a broadcast from the container does not reach the
  LAN (bridge network); the core's `udp-active-broadcast` would work and is
  planned (milestone 3).
- **Poll interval**: 30 s by default, 10 s to 1 h (a local device).
- **Cover**: `scripts/cover.mjs` (plain Node), 800×534.
