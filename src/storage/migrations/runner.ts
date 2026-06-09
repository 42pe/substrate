import { copyFile } from 'node:fs/promises';
import type { Client, Transaction } from '@libsql/client';
import { SubstrateError } from '../../core/errors.js';
import { logger } from '../../shared/logger.js';
import { migration001 } from './001-initial.js';
import { migration002 } from './002-comments-events.js';

/**
 * A migration is a forward-only schema change with a stable integer id.
 * Migrations are applied in id order; each runs inside its own transaction.
 *
 * `up()` receives a `Transaction` (not a `Client`) — schema changes must
 * never escape the transactional boundary. The runner is the only valid
 * invoker; constructing a migration that's intended to run outside a
 * transaction is a category error.
 */
export interface Migration {
  id: number;
  description: string;
  up(tx: Transaction): Promise<void>;
}

/**
 * The full list of v1 migrations, statically imported in id order.
 *
 * As new migrations land, append to this array. Never reorder, never delete,
 * never modify a migration that has shipped — make a new one.
 *
 * Tests that need a different migration list pass their own array to
 * `runMigrations` rather than mutating this export.
 */
export const migrations: readonly Migration[] = Object.freeze([migration001, migration002]);

/**
 * Read the current schema version from `PRAGMA user_version`.
 * Returns 0 for a fresh database (libsql / SQLite default).
 */
export async function getCurrentSchemaVersion(client: Client): Promise<number> {
  const result = await client.execute('PRAGMA user_version');
  const row = result.rows[0];
  if (!row) return 0;
  // libsql may return numeric pragma values as number or bigint
  const raw = (row as Record<string, unknown>)['user_version'];
  if (typeof raw === 'bigint') return Number(raw);
  if (typeof raw === 'number') return raw;
  return 0;
}

/**
 * Apply all pending migrations forward to bring the database to the target
 * version (typically `BINARY_SCHEMA_VERSION`).
 *
 * Refuses (throws `SubstrateError.internalError`) if the file's current
 * version exceeds the binary's target — that means the file was written by
 * a newer Substrate and we can't safely downgrade.
 *
 * Each migration runs inside its own transaction. On failure, the
 * transaction rolls back; the error propagates; subsequent migrations do
 * not run. `PRAGMA user_version` is stamped inside the same transaction as
 * the migration's `up()` so the version bump is atomic with the schema
 * change.
 *
 * If `tx.rollback()` itself throws, the rollback failure is attached as
 * `Error.cause` on the original migration error — the original failure
 * is the more interesting signal for debugging.
 *
 * `migrationList` defaults to the module-level `migrations` constant. Tests
 * pass a custom list to validate rollback / version-check behavior without
 * mutating the production list.
 *
 * Auto-backup (Phase 4): when `dbPath` is given AND there are pending
 * migrations, the database file is copied to `data.sqlite.bak-<timestamp>`
 * before any migration runs. Migrations are transactional, so on failure the
 * original `data.sqlite` is unchanged and the backup is a redundant safety net.
 * No backup is taken when nothing is pending. No retention/pruning in v1.
 */
export async function runMigrations(
  client: Client,
  targetVersion: number,
  migrationList: readonly Migration[] = migrations,
  dbPath?: string,
): Promise<void> {
  const current = await getCurrentSchemaVersion(client);

  if (current > targetVersion) {
    throw SubstrateError.internalError(
      `data.sqlite was written by Substrate schema v${current}, but this binary ` +
        `supports up to v${targetVersion}. Upgrade Substrate to the newer version, ` +
        `or restore data.sqlite from a backup written by the older binary.`,
      { fileVersion: current, binaryVersion: targetVersion },
    );
  }

  const pending = [...migrationList]
    .filter((m) => m.id > current && m.id <= targetVersion)
    .sort((a, b) => a.id - b.id);

  if (pending.length > 0 && dbPath !== undefined) {
    // Checkpoint the WAL into the main file so the copy is a consistent
    // snapshot, then copy. Best-effort: a backup failure must NOT block the
    // migration (the migration is transactional and self-protecting).
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${dbPath}.bak-${stamp}`;
    try {
      await client.execute('PRAGMA wal_checkpoint(TRUNCATE)');
      await copyFile(dbPath, backupPath);
    } catch (e) {
      logger.error('Pre-migration backup failed (continuing — migrations are transactional)', {
        error: (e as Error).message,
        err: e,
      });
    }
  }

  for (const migration of pending) {
    const tx = await client.transaction('write');
    try {
      await migration.up(tx);
      await tx.execute(`PRAGMA user_version = ${migration.id}`);
      await tx.commit();
    } catch (originalError) {
      try {
        await tx.rollback();
      } catch (rollbackError) {
        // Preserve the original failure; attach rollback failure as cause.
        // The original error is the actionable signal; the rollback failure
        // is operational noise we don't want to lose visibility into either.
        if (originalError instanceof Error) {
          (originalError as Error & { cause?: unknown }).cause = rollbackError;
        }
      }
      throw originalError;
    }
  }
}
