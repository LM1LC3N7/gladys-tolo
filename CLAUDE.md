# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration**: a Node.js service (Node 22+, ESM,
no build step) that runs in its own sandboxed Docker container and talks to
Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template.
It reads and commands a TOLO steam generator or sauna through its App Box, on
the local network, in UDP (port 51500).

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
node --test --test-name-pattern "turn off"   # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run cover                             # cover.png (plain Node)
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only: handlers registered before connect()
src/handlers.js                   SDK handlers -> ToloApp (shared with the tests)
src/app.js                        polling, device, states, status, commands and their guards
src/devices.js                    device and states (pure); feature roles are frozen
src/tolo/protocol.js              frames, requests, strict parsing (pure), port of tololib
src/tolo/client.js                status, settings, sets: one exchange each
src/tolo/udp.js                   the only network access: one UDP socket per exchange
src/store.js                      /data/tolo-state.json: last read time, turn off guard
src/publisher.js                  states to Gladys within 300 per minute
src/config.js                     DEFAULT_CONFIG (mirrors the manifest defaults) + normalization
src/i18n.js                       English and French runtime texts
scripts/cover.mjs                 cover.png generator (plain Node, no dependency)
gladys-assistant-integration.json manifest: name, config_schema, actions, image...
docs/en.md, docs/fr.md            user documentation, re-hosted by Gladys (mandatory)
test/                             node --test, against the SDK's fake Gladys (integration-sdk/testing)
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

## Rules

- **External ids are forever.** `gladys.externalIds('tolo', 'appbox')`: one
  App Box per integration (the protocol has no serial number). Feature roles
  (`src/constants.js` FEATURES) and manifest keys never change.
- **The container rootfs is read-only.** Write only under `/data`.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand. `test/manifest.test.js` checks they agree (never a pinned value).
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md`. Never write a version heading.
- **Manifest.** Texts are `{ "en": ..., "fr": ... }`; the catalog
  `description` holds 10 to 100 characters per language.
- **User-facing text** is bilingual and UTF-8 without BOM, without control
  bytes (`test/encoding.test.js`).
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network beyond the loopback.
- **UDP.** One socket per attempt, all closed at the end of the exchange
  (never a shared socket: a late answer would be taken for another
  request's); a socket error ends one attempt only; source address and port
  checked, datagram size bounded, frame, command, length and the echo of a
  set checked; every answer judged on a read. Only the
  commands of `COMMAND` are ever sent.
- **TOLO.** Turning on and the setpoint stay behind `allow_heating` (off by
  default): a button and a thermostat setpoint, never a switch; turning on
  is decided on a fresh read, sets the timer (`session_minutes`, never "no
  timer", 60 min at most) and caps the setpoint (`max_temperature`, 60 °C at
  most) before it, both read back; the option, a turn off and the deadline
  are checked again right before every datagram; it is confirmed only with
  the timer read back, and a Gladys session without it is turned off.
  Turning off (any value presses it) is never held
  back (option, command in flight, read, unreachable App Box, before the
  first read), never preceded by a read, sent again when a turn on may land
  after it, and reaffirmed by the reads of the next 2 min (guard in `/data`).
  The App Box is never read sooner than the interval after the last read
  (kept in `/data`).
