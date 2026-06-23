import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabaseAndMigrate, openClient, withTransaction } from './client.js';
import { BINARY_SCHEMA_VERSION } from '../core/version.js';
import { getCurrentSchemaVersion } from './migrations/runner.js';
import { SubstrateError } from '../core/errors.js';

describe('openDatabaseAndMigrate', () => {
  let dir: string;
  let dbPath: string;
  let client: Awaited<ReturnType<typeof openDatabaseAndMigrate>> | null = null;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'substrate-storage-'));
    dbPath = join(dir, '.substrate', 'data.sqlite');
    client = null;
  });

  afterEach(async () => {
    if (client) {
      client.close();
      client = null;
    }
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it('creates a fresh database with migrations applied and WAL on', async () => {
    client = await openDatabaseAndMigrate(dbPath);
    const version = await getCurrentSchemaVersion(client);
    expect(version).toBe(BINARY_SCHEMA_VERSION);

    const journal = await client.execute('PRAGMA journal_mode');
    expect((journal.rows[0] as Record<string, unknown>)['journal_mode']).toBe('wal');
  });

  it('creates the tasks table per migration 001', async () => {
    client = await openDatabaseAndMigrate(dbPath);
    const tables = await client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'",
    );
    expect(tables.rows).toHaveLength(1);
  });

  it('is idempotent — re-opening an already-migrated DB does not error', async () => {
    client = await openDatabaseAndMigrate(dbPath);
    client.close();
    client = await openDatabaseAndMigrate(dbPath);
    const version = await getCurrentSchemaVersion(client);
    expect(version).toBe(BINARY_SCHEMA_VERSION);
  });

  it('refuses to open if file user_version > BINARY_SCHEMA_VERSION', async () => {
    // Create a fresh DB, then tamper with user_version
    client = await openDatabaseAndMigrate(dbPath);
    await client.execute('PRAGMA user_version = 999');
    client.close();
    client = null;

    let caught: unknown;
    try {
      client = await openDatabaseAndMigrate(dbPath);
    } catch (e) {
      caught = e;
    }
    expect(SubstrateError.is(caught)).toBe(true);
    if (SubstrateError.is(caught)) {
      expect(caught.code).toBe('internal_error');
      expect(caught.message).toMatch(/schema v999/);
      expect(caught.details).toEqual({ fileVersion: 999, binaryVersion: BINARY_SCHEMA_VERSION });
    }
  });

  it('sets busy_timeout', async () => {
    client = await openDatabaseAndMigrate(dbPath);
    const result = await client.execute('PRAGMA busy_timeout');
    const timeout = (result.rows[0] as Record<string, unknown>)['timeout'];
    expect(timeout).toBe(5000);
  });
});

describe('openClient', () => {
  let dir: string;
  let dbPath: string;
  let client: Awaited<ReturnType<typeof openClient>> | null = null;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'substrate-storage-'));
    dbPath = join(dir, '.substrate', 'data.sqlite');
    client = null;
  });

  afterEach(async () => {
    if (client) {
      client.close();
      client = null;
    }
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it('opens without running migrations', async () => {
    // openClient will create the file if missing but won't migrate.
    // The DB is empty; user_version should be 0.
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(dir, '.substrate'), { recursive: true });

    client = await openClient(dbPath);
    const version = await getCurrentSchemaVersion(client);
    expect(version).toBe(0);

    const tables = await client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'",
    );
    expect(tables.rows).toHaveLength(0);
  });
});

describe('withTransaction', () => {
  let dir: string;
  let dbPath: string;
  let client: Awaited<ReturnType<typeof openDatabaseAndMigrate>> | null = null;

  async function busyTimeout(c: NonNullable<typeof client>): Promise<number> {
    const r = await c.execute('PRAGMA busy_timeout');
    const v = (r.rows[0] as Record<string, unknown>)['timeout'];
    return typeof v === 'bigint' ? Number(v) : (v as number);
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'substrate-tx-'));
    dbPath = join(dir, '.substrate', 'data.sqlite');
    client = await openDatabaseAndMigrate(dbPath);
  });

  afterEach(async () => {
    if (client) {
      client.close();
      client = null;
    }
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it('commits and returns the fn result', async () => {
    const c = client!;
    const result = await withTransaction(c, async (tx) => {
      await tx.execute({
        sql: `INSERT INTO tasks (id, board_id, group_id, title, description, custom_data, version, created_by_agent, created_at, updated_at)
              VALUES ('t1','b','g','hi','','{}',1,'a','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
      });
      return 'ok';
    });
    expect(result).toBe('ok');
    const rows = await c.execute("SELECT id FROM tasks WHERE id = 't1'");
    expect(rows.rows).toHaveLength(1);
  });

  it('rolls back on error and rethrows the original', async () => {
    const c = client!;
    await expect(
      withTransaction(c, async (tx) => {
        await tx.execute({
          sql: `INSERT INTO tasks (id, board_id, group_id, title, description, custom_data, version, created_by_agent, created_at, updated_at)
                VALUES ('t2','b','g','hi','','{}',1,'a','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
        });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    // Rolled back — row not persisted
    const rows = await c.execute("SELECT id FROM tasks WHERE id = 't2'");
    expect(rows.rows).toHaveLength(0);
  });

  it('re-applies busy_timeout after a successful commit', async () => {
    const c = client!;
    // A bare transaction (without withTransaction) resets busy_timeout to 0.
    // withTransaction must restore it.
    await withTransaction(c, async (tx) => {
      await tx.execute('SELECT 1');
    });
    expect(await busyTimeout(c)).toBe(5000);
  });

  it('re-applies busy_timeout after a rollback', async () => {
    const c = client!;
    await withTransaction(c, async () => {
      throw new Error('rollback me');
    }).catch(() => undefined);
    expect(await busyTimeout(c)).toBe(5000);
  });
});
