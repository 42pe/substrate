import { createClient, type Client } from '@libsql/client';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { BINARY_SCHEMA_VERSION } from '../core/version.js';
import { runMigrations } from './migrations/runner.js';

/**
 * SQLite busy_timeout for all connections, per Substrate convention.
 * Tolerates brief contention transparently. Set on every connection.
 */
const BUSY_TIMEOUT_MS = 5000;

/**
 * Open a libsql client and set `busy_timeout` only — does not apply
 * migrations, does not set WAL/synchronous, does not validate that the file
 * already exists. libsql's `file:` URL will create the file if missing.
 *
 * Use this when you need a connection without performing schema work:
 *   - the schema-version refuse-to-open path (read user_version before
 *     deciding to migrate)
 *   - tests that want a raw client over a temp file
 *
 * Despite the name, this is NOT side-effect-free at the connection level:
 * `PRAGMA busy_timeout` is a per-connection setting. It does not touch the
 * database file. Connection-level side effects are unavoidable in libsql.
 */
export async function openClient(dbPath: string): Promise<Client> {
  const client = createClient({ url: `file:${dbPath}` });
  await client.execute(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
  return client;
}

/**
 * Open a libsql connection AND bring the database to the binary's expected
 * schema version. Single owner of DB lifecycle — used by `substrate init`,
 * `substrate serve`, `substrate mcp`, and repository tests.
 *
 * Behavior:
 *   1. Ensures the parent directory exists.
 *   2. Opens the libsql client; sets `busy_timeout`.
 *   3. Sets `journal_mode = WAL` and `synchronous = NORMAL` (idempotent;
 *      these persist in the file header, so they're no-ops after the
 *      database is initialized).
 *   4. Runs the migration runner, which either:
 *        - applies pending migrations forward, or
 *        - refuses to open if the file's schema version > the binary's
 *          target version (returns `SubstrateError.internalError`).
 *   5. Re-applies `busy_timeout` (libsql resets it after a transaction
 *      commits; see comment below).
 *
 * Callers are responsible for `client.close()` when done.
 */
export async function openDatabaseAndMigrate(dbPath: string): Promise<Client> {
  await mkdir(dirname(dbPath), { recursive: true });
  const client = await openClient(dbPath);
  await client.execute('PRAGMA journal_mode = WAL');
  await client.execute('PRAGMA synchronous = NORMAL');
  await runMigrations(client, BINARY_SCHEMA_VERSION);

  // libsql quirk (verified 2026-05-09 by Phase 1 spike): committing a
  // transaction resets the client's `busy_timeout` to 0. The migration
  // runner uses transactions, so by this point the timeout is 0 and any
  // contended write would immediately return SQLITE_BUSY instead of
  // waiting. Re-apply it.
  //
  // Phase 2 will need a `withTransaction(client, fn)` helper that
  // re-applies busy_timeout after commit. Substrate-edit tools in Phase 4
  // do NOT need this — they write to JSON files (boards/*.json) via
  // atomic temp-and-rename, not to SQLite. Where the helper bites:
  //   - Phase 2: update_task (bumps version + emits TaskEvent atomically)
  //   - Phase 2: add_comment / edit_comment (write row + TaskEvent)
  //   - Phase 3: policy engine cascades (multi-write within one call)
  await client.execute(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);

  return client;
}
