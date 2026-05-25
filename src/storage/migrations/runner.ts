import type { Client, Transaction } from '@libsql/client';
import { SubstrateError } from '../../core/errors.js';
import { migration001 } from './001-initial.js';

/**
 * A migration is a forward-only schema change with a stable integer id.
 * Migrations are applied in id order; each runs inside its own transaction.
 *
 * `up()` receives a transaction handle, not the client — schema changes
 * should never escape the transactional boundary.
 */
export interface Migration {
  id: number;
  description: string;
  up(tx: Client | Transaction): Promise<void>;
}

/**
 * The full list of v1 migrations, statically imported in id order.
 *
 * As new migrations land, append to this array. Never reorder, never delete,
 * never modify a migration that has shipped — make a new one.
 */
export const migrations: readonly Migration[] = [migration001];

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
 * Backup-before-migration is deferred to Phase 4 per the v1 architecture
 * plan; Phase 1's runner has version-check + transactional apply only.
 */
export async function runMigrations(client: Client, targetVersion: number): Promise<void> {
  const current = await getCurrentSchemaVersion(client);

  if (current > targetVersion) {
    throw SubstrateError.internalError(
      `data.sqlite was written by Substrate schema v${current}, but this binary ` +
        `supports up to v${targetVersion}. Upgrade Substrate to the newer version, ` +
        `or restore data.sqlite from a backup written by the older binary.`,
      { fileVersion: current, binaryVersion: targetVersion },
    );
  }

  const pending = [...migrations].filter((m) => m.id > current).sort((a, b) => a.id - b.id);

  for (const migration of pending) {
    if (migration.id > targetVersion) {
      // Migration exists in code but is ahead of the requested target; skip.
      // Useful for tests that pin to an older target.
      continue;
    }
    const tx = await client.transaction('write');
    try {
      await migration.up(tx);
      await tx.execute(`PRAGMA user_version = ${migration.id}`);
      await tx.commit();
    } catch (e) {
      await tx.rollback();
      throw e;
    }
  }
}
