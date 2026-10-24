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
- [x] **Review r1 fixes** (2026-10-24), tests in `test/review1.test.js`:
      1 a turn on is confirmed only with a timer of 1 to `session_minutes`
      read back; a Gladys session found without it (then, or by a later
      read, until its end + 2 min) gets the timer again, then is turned off
      (logged, in the status). 2 any value presses "Turn off". 3 a socket
      error (ICMP) ends one attempt only; one fresh socket per attempt.
      4 a "refused" answer is judged on a read (turn on, turn off, setpoint,
      lamp, fan). 5 a lamp/fan command that turns the App Box on: turned
      off at once, refused. 6 docs and texts without false absolutes,
      complete refusal lists. 7 a guard restored from /data gets a read 5 s
      after the start. 8 during a turn off guard, only a lower setpoint.
      9 a turn off before the configuration is loaded uses the SDK cache
      (`gladys.config`), else the guard address in /data. 10 the value byte
      of status and settings answers is not checked (as tololib). 11 a set
      answer must echo the value sent. 12 refusal texts fixed (both
      languages, exact causes). 13 a turn on overtaken by a turn off is not
      a success. 14 comment fixed. 15 "4 datagrams at most".
- [x] **Review r2 fixes** (2026-10-24), tests in `test/review2.test.js`:
      1 the read after a timer rewrite is strict (1 to the value written),
      else turn off; a timer at 0 accepted only in the last minute of the
      session; a dedicated read at the planned end + 2 min turns off an App
      Box still on (or unread), with guard, log and status. 2 a rewrite
      writes only what is left of the session (1 min at least), a planned
      end passed turns off: the integration never extends a session.
      3 the watch is kept in /data (`session`), restored at the start with
      its end read. 4 lamp/fan: the state before is a read of less than
      10 s (a fresh one otherwise). 5 the setpoint reads the status back
      too: off to on turns it off and refuses.
- [ ] **Milestone 2 — real App Box**: run against a real App Box (see "To
      check"), turn the frames (anonymized) into fixtures.
- [ ] **Milestone 3 — more**: discovery through the core
      (`network_discovery` `udp-active-broadcast` on port 51500, tololib's
      `discover` message), humidity setpoint, aroma therapy, salt bath,
      sweep and fan timers (pumps and valves: behind options), scene trigger
      "ready" (temperature reached).

## To check on a real App Box

- Whether a set is answered with its own value echoed (as tololib's
  simulator does): the code requires the echo (review r1, lesson 18 of
  lot 14). If the real App Box does not echo, every command becomes "sent,
  without confirmation" (the read back still shows the effect): relax it
  then.
- The meaning of the extra byte of a set answer (00 accepted): every answer
  is judged on a read anyway.
- The value byte of status and settings answers (0x11 and 0x08 in tololib's
  simulator; not checked here, as tololib).
- Whether the lamp and fan commands only drive their output (an App Box
  turned on by them is turned off at once).
- Whether the power timer set before the power on is the one the session
  uses (status byte 2 counting down), and what status byte 2 shows while
  off. Until checked, a turn on without the timer read back is not a
  success, and the session is turned off if the timer cannot be set.
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
- **UDP, one socket per attempt** (all closed at the end of the exchange):
  attribution of answers by the socket (the kernel filters other sources of
  a connected socket; checked again in code); never a shared socket. A
  socket error (ICMP port unreachable, EHOSTUNREACH, a failed send) ends
  that attempt only. A set answer must have its command code and the value
  sent echoed; extra 00 "accepted", else "refused"; either way the outcome
  is decided on a read after.
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
  on/off" may reach them. According to tololib they only drive their
  output (not checked); a read showing the App Box turned on by one of
  them (off just before, no turn on from Gladys in flight) turns it off at
  once. One command at a time per role.
- **Session watch** (reviews r1, r2): from the first power on datagram of
  a turn on from Gladys until a read shows it off, kept in /data
  (`session`: address, minutes, planned end, wall clock). Every status read
  on needs a timer of 1 to min(`session_minutes`, minutes left + 1), or 0
  in the last minute only; otherwise the timer is written with the minutes
  LEFT (never more; planned end passed: turn off) and read strictly (1 to
  the value written), else turn off. A dedicated read at the planned end +
  2 min turns off an App Box still on, or unread (protective). The turn
  on's own ack needs 1 to `session_minutes`. Sessions started elsewhere
  are not watched.
- **Turn off presses on any value** (review r1): a scene or an "everything
  off" may send 0 or true; turning on still takes exactly 1.
- **Setpoint during a turn off guard**: only lower than the setpoint known.
- **Turn off before the configuration is loaded**: the address of the SDK's
  cached configuration (`gladys.config`), else of the guard in /data.
- **No door sensor** on TOLO: nothing like Huum's door check; the docs warn.
- **Not read**: aroma therapy, sweep, salt bath, flow in/out, fan timer,
  target humidity (read, not published), model.
- **No discovery in v1**: a broadcast from the container does not reach the
  LAN (bridge network); the core's `udp-active-broadcast` would work and is
  planned (milestone 3).
- **Poll interval**: 30 s by default, 10 s to 1 h (a local device).
- **Cover**: `scripts/cover.mjs` (plain Node), 800×534.
