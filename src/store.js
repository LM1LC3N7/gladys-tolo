// -----------------------------------------------------------------------------
// What must survive a restart, in /data (the only writable place of the
// container):
//   - the time of the last read (written at most once a minute, BEFORE the
//     read), so a restart never reads sooner than the interval;
//   - the guard of a turn off that heating may still overtake (a turn on
//     sent before it, or a turn off without confirmation): after a restart,
//     the reads of its remaining time still send the turn off again if the
//     App Box heats. Kept with the address it was sent to.
// No secret exists in this integration. The file is readable by the
// container user only (0600), bounded and repaired when read back (a
// hand-edited or damaged file never stops the integration for good).
// -----------------------------------------------------------------------------

import { readFile, rename, writeFile } from 'node:fs/promises';
import { TIMINGS } from './constants.js';
import { hostOf } from './config.js';

export const STATE_FILE = '/data/tolo-state.json';

export function fileStore(path = STATE_FILE) {
  // One write at a time: two saves never share the temporary file.
  let chain = Promise.resolve();
  return {
    async load() {
      try {
        const text = await readFile(path, 'utf8');
        return text.length > 16 * 1024 ? null : JSON.parse(text);
      } catch {
        return null;
      }
    },
    save(data) {
      const text = JSON.stringify(data);
      const write = chain.then(async () => {
        const temporary = `${path}.tmp`;
        await writeFile(temporary, text, { mode: 0o600 });
        await rename(temporary, path);
      });
      chain = write.catch(() => {});
      return write;
    },
  };
}

/** For the tests: the same JSON round trip as the file. */
export function memoryStore(initial = null) {
  return {
    data: initial === null ? null : JSON.parse(JSON.stringify(initial)),
    saves: 0,
    async load() {
      return this.data === null ? null : JSON.parse(JSON.stringify(this.data));
    },
    async save(data) {
      this.data = JSON.parse(JSON.stringify(data));
      this.saves += 1;
    },
  };
}

const object = (value) =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};

/**
 * The persisted state, repaired and bounded (wall-clock times):
 * `{ lastAttemptAt: number | null,
 *    stopGuard: { host, until, reasserts, sticky } | null }`.
 */
export function normalizeMemory(raw, now) {
  const data = object(raw);
  const guard = object(data.stopGuard);
  const host = hostOf(guard.host);
  return {
    // A time in the future (a clock set back) counts as now: never a longer wait than the interval.
    lastAttemptAt:
      Number.isFinite(data.lastAttemptAt) && data.lastAttemptAt > 0
        ? Math.min(data.lastAttemptAt, now)
        : null,
    stopGuard:
      host && Number.isFinite(guard.until) && guard.until > now
        ? {
            host,
            // Capped from now: a clock jump or an edited file never keeps it longer.
            until: Math.min(guard.until, now + TIMINGS.guard),
            reasserts:
              Number.isInteger(guard.reasserts) && guard.reasserts >= 0
                ? Math.min(guard.reasserts, TIMINGS.stopReasserts)
                : 0,
            sticky: guard.sticky === true,
          }
        : null,
  };
}
