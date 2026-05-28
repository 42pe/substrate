import { createClient, type Client, type Transaction } from '@libsql/client';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { BINARY_SCHEMA_VERSION } from '../core/version.js';
import { runMigrations } from './migrations/runner.js';

/**
 * A thing you can run SQL against — either the pooled client or an open
 * write transaction. Repository functions accept this so the SAME function
 * works for non-transactional reads (pass the Client) and for atomic write
 * sequences (pass the Transaction). Repos must NEVER open their own
 * transaction — the handler owns the transaction (see `withTransaction`).
 */
export type Executor = Client | Transaction;

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
  // runner uses transactions, so by this point the timeout is 0. Re-apply.
  // (`withTransaction` does the same after every application-level commit.)
  await client.execute(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);

  return client;
}

/**
 * Run `fn` inside a single libsql write transaction, committing on success
 * and rolling back on error. The HANDLER owns the transaction — repository
 * functions take an `Executor` and never open their own. This keeps a
 * write's read-for-merge, the write itself, and its TaskEvent emission
 * atomic (so a crash mid-write never leaves a row at a new state with no
 * audit event, and the OCC read-for-merge can't race the write).
 *
 * Re-applies `busy_timeout` in a `finally` — libsql resets it to 0 after a
 * commit (and we reapply after rollback too, defensively). The `.catch`
 * swallows a PRAGMA error if the connection is already dead, so cleanup
 * never masks the original failure.
 *
 * On rollback failure, the rollback error is attached as `Error.cause` of
 * the original error (mirrors the migration runner's pattern) — the
 * original failure is the actionable signal.
 *
 * Substrate convention: the Client is single-threaded — one MCP call runs
 * one fully-awaited transaction at a time. Do not issue concurrent
 * statements on the same Client.
 */
export async function withTransaction<T>(
  client: Client,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  const tx = await client.transaction('write');
  try {
    const result = await fn(tx);
    await tx.commit();
    return result;
  } catch (originalError) {
    try {
      await tx.rollback();
    } catch (rollbackError) {
      if (originalError instanceof Error) {
        (originalError as Error & { cause?: unknown }).cause = rollbackError;
      }
    }
    throw originalError;
  } finally {
    await client.execute(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`).catch(() => undefined);
  }
}
