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
 * Open a libsql connection to a file. Sets only `busy_timeout` — does not
 * apply migrations or set WAL/synchronous PRAGMAs. Use this when you need
 * to inspect an existing database without performing any side effects (e.g.,
 * the schema-version refuse-to-open path that runs before migrations).
 */
export async function openExistingDatabase(dbPath: string): Promise<Client> {
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
 *
 * Callers are responsible for `client.close()` when done.
 */
export async function openDatabaseAndMigrate(dbPath: string): Promise<Client> {
  await mkdir(dirname(dbPath), { recursive: true });
  const client = await openExistingDatabase(dbPath);
  await client.execute('PRAGMA journal_mode = WAL');
  await client.execute('PRAGMA synchronous = NORMAL');
  await runMigrations(client, BINARY_SCHEMA_VERSION);

  // libsql quirk (verified 2026-05-09 by Phase 1 spike): committing a
  // transaction resets the client's `busy_timeout` to 0. The migration
  // runner uses transactions, so by this point the timeout is 0 and any
  // contended write would immediately return SQLITE_BUSY instead of
  // waiting. Re-apply it. Phase 4 will need a `withTransaction` helper
  // that re-applies after any application-level transaction commits.
  await client.execute(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);

  return client;
}
