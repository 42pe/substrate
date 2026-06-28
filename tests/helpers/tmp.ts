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
 * So: try a few quick retries (covers a merely-lagging handle), and if the
 * handle is genuinely still held, SWALLOW the error and leak the temp dir. CI
 * runners are ephemeral and the OS reclaims `%TEMP%`, so a leaked dir is
 * harmless; a failed/hung teardown is not. On POSIX this is a no-op cost — the
 * first unlink succeeds (you can delete an open file), so the retries/catch
 * never engage. Never throws.
 */
export async function rmrf(path: string): Promise<void> {
  try {
    await rm(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch {
    // Stubbornly-held handle (Windows + libsql): leak the temp dir rather than
    // fail or hang teardown. The OS cleans %TEMP%.
  }
}

/** Synchronous {@link rmrf} for sync teardown callbacks. Same best-effort semantics. */
export function rmrfSync(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch {
    // best-effort — see rmrf().
  }
}
