import { rm } from 'node:fs/promises';
import { rmSync } from 'node:fs';

/**
 * Best-effort recursive remove of a test temp directory. Use this in
 * `afterEach`/`afterAll` instead of `rm(dir, { recursive, force })`.
 *
 * Why this exists: on Windows, `@libsql/client`'s native `close()` does not
 * release the underlying SQLite file handle (`data.sqlite` and its `-wal`/`-shm`
 * siblings) — verified on a Windows VM, where the built-in `node:sqlite` closes
 * and deletes the very same WAL database cleanly, but libsql leaves the handle
 * open. Deleting that temp dir then throws `EBUSY`/`EPERM`. A naive high
 * `maxRetries` makes it *worse* (each permanently-held file burns the full
 * backoff, hanging the suite past the hook timeout).
 *
 * So: attempt the remove ONCE and SWALLOW any error, leaking the temp dir. CI
 * runners are ephemeral and the OS reclaims `%TEMP%`, so a leaked dir is
 * harmless; a failed/hung teardown is not.
 *
 * Crucially, do NOT pass `maxRetries`: against a held handle the libsql leak is
 * permanent (the handle never releases within the process), so retries can't
 * succeed — they only *block*. Measured on a Windows VM: a single failing
 * `rm` returns in ~3ms, but with `maxRetries:3` it spins ~3.3s PER locked file,
 * and a WAL db has three (`data.sqlite`, `-wal`, `-shm`) → ~10s, which blows
 * vitest's hook timeout on every DB test. No retries = fail fast + swallow.
 *
 * On POSIX this is a no-op cost: the first unlink succeeds (you can delete an
 * open file). Never throws.
 */
export async function rmrf(path: string): Promise<void> {
  try {
    await rm(path, { recursive: true, force: true });
  } catch {
    // Stubbornly-held handle (Windows + libsql): leak the temp dir rather than
    // fail teardown. The OS cleans %TEMP%.
  }
}

/** Synchronous {@link rmrf} for sync teardown callbacks. Same best-effort semantics. */
export function rmrfSync(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    // best-effort — see rmrf().
  }
}
