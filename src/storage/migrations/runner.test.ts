import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getCurrentSchemaVersion, runMigrations, type Migration } from './runner.js';
import { migration001 } from './001-initial.js';
import { SubstrateError } from '../../core/errors.js';

async function tempDbClient(): Promise<{ client: Client; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'substrate-runner-'));
  const dbPath = join(dir, 'test.sqlite');
  const client = createClient({ url: `file:${dbPath}` });
  await client.execute('PRAGMA busy_timeout = 5000');
  return { client, dir };
}

describe('getCurrentSchemaVersion', () => {
  it('returns 0 on a fresh database', async () => {
    const { client, dir } = await tempDbClient();
    try {
      expect(await getCurrentSchemaVersion(client)).toBe(0);
    } finally {
      client.close();
      await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });

  it('returns the stamped version after migration', async () => {
    const { client, dir } = await tempDbClient();
    try {
      await client.execute('PRAGMA user_version = 42');
      expect(await getCurrentSchemaVersion(client)).toBe(42);
    } finally {
      client.close();
      await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });
});

describe('runMigrations', () => {
  let client: Client;
  let dir: string;

  beforeEach(async () => {
    const tmp = await tempDbClient();
    client = tmp.client;
    dir = tmp.dir;
  });

  afterEach(async () => {
    client.close();
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it('applies migration 001 to an empty database', async () => {
    expect(await getCurrentSchemaVersion(client)).toBe(0);
    await runMigrations(client, 1);
    expect(await getCurrentSchemaVersion(client)).toBe(1);

    const tables = await client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    );
    const names = tables.rows.map((r) => (r as Record<string, unknown>)['name']);
    expect(names).toContain('tasks');
  });

  it('is a no-op when already at the target version', async () => {
    await runMigrations(client, 1);
    // Second call should not error and version stays at 1
    await runMigrations(client, 1);
    expect(await getCurrentSchemaVersion(client)).toBe(1);
  });

  it('refuses when file version > target', async () => {
    await client.execute('PRAGMA user_version = 999');
    let caught: unknown;
    try {
      await runMigrations(client, 1);
    } catch (e) {
      caught = e;
    }
    expect(SubstrateError.is(caught)).toBe(true);
    if (SubstrateError.is(caught)) {
      expect(caught.code).toBe('internal_error');
      expect(caught.message).toMatch(/v999/);
    }
  });

  it('rolls back the transaction when a migration throws', async () => {
    // Synthesize a faulty migration that creates a table then throws
    const faulty: Migration = {
      id: 2,
      description: 'intentionally fails',
      async up(tx) {
        await tx.execute('CREATE TABLE poisoned (x TEXT)');
        throw new Error('boom');
      },
    };
    const testList: readonly Migration[] = [migration001, faulty];

    // Bring to v1 cleanly using the test list (same as production migration001)
    await runMigrations(client, 1, testList);
    expect(await getCurrentSchemaVersion(client)).toBe(1);

    let caught: unknown;
    try {
      await runMigrations(client, 2, testList);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('boom');

    // Version stayed at 1 — the failed migration did not stamp
    expect(await getCurrentSchemaVersion(client)).toBe(1);

    // The `poisoned` table was rolled back, not persisted
    const poisoned = await client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='poisoned'",
    );
    expect(poisoned.rows).toHaveLength(0);
  });

  it('attaches rollback failure as Error.cause without masking the original', async () => {
    // Simulate a tx where both up() and rollback() fail.
    // We can't easily make libsql's rollback throw, so we wrap a transaction
    // proxy that overrides rollback.
    const faulty: Migration = {
      id: 2,
      description: 'fails up() with a rollback that also fails',
      async up(tx) {
        // Monkey-patch rollback on this specific tx instance to throw
        const originalRollback = tx.rollback.bind(tx);
        tx.rollback = async () => {
          // Drain the real rollback so we don't leak — but report a failure to the caller
          await originalRollback().catch(() => undefined);
          throw new Error('rollback also failed');
        };
        throw new Error('up failed');
      },
    };
    const testList: readonly Migration[] = [migration001, faulty];

    await runMigrations(client, 1, testList);

    let caught: Error | undefined;
    try {
      await runMigrations(client, 2, testList);
    } catch (e) {
      caught = e as Error;
    }
    expect(caught?.message).toBe('up failed');
    const cause = (caught as Error & { cause?: unknown }).cause;
    expect((cause as Error)?.message).toBe('rollback also failed');
  });
});

describe('auto-backup before migration (Phase 4)', () => {
  it('writes a .bak file when migrations are pending, and reaches the target version', async () => {
    const { readdir } = await import('node:fs/promises');
    const dir = await mkdtemp(join(tmpdir(), 'substrate-backup-'));
    const dbPath = join(dir, 'data.sqlite');
    const client = createClient({ url: `file:${dbPath}` });
    try {
      await client.execute('PRAGMA busy_timeout = 5000');
      await runMigrations(client, 2, undefined, dbPath);
      expect(await getCurrentSchemaVersion(client)).toBe(2);
      const baks = (await readdir(dir)).filter((f) => f.includes('data.sqlite.bak-'));
      expect(baks.length).toBe(1);
    } finally {
      client.close();
      await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });

  it('takes NO backup when nothing is pending', async () => {
    const { readdir } = await import('node:fs/promises');
    const dir = await mkdtemp(join(tmpdir(), 'substrate-backup-'));
    const dbPath = join(dir, 'data.sqlite');
    const client = createClient({ url: `file:${dbPath}` });
    try {
      await client.execute('PRAGMA busy_timeout = 5000');
      await runMigrations(client, 2, undefined, dbPath); // applies 1+2
      const before = (await readdir(dir)).filter((f) => f.includes('.bak-')).length;
      await runMigrations(client, 2, undefined, dbPath); // nothing pending
      const after = (await readdir(dir)).filter((f) => f.includes('.bak-')).length;
      expect(after).toBe(before); // no new backup
    } finally {
      client.close();
      await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });

  it('leaves the original intact + backup present on a mid-migration failure', async () => {
    const { readdir } = await import('node:fs/promises');
    const dir = await mkdtemp(join(tmpdir(), 'substrate-backup-'));
    const dbPath = join(dir, 'data.sqlite');
    const client = createClient({ url: `file:${dbPath}` });
    const throwing: Migration = {
      id: 2,
      description: 'boom',
      up: async () => {
        throw new Error('mid-migration failure');
      },
    };
    try {
      await client.execute('PRAGMA busy_timeout = 5000');
      await expect(runMigrations(client, 2, [migration001, throwing], dbPath)).rejects.toThrow(
        'mid-migration failure',
      );
      // 001 committed; the throwing 002 rolled back → version stays at 1.
      expect(await getCurrentSchemaVersion(client)).toBe(1);
      const baks = (await readdir(dir)).filter((f) => f.includes('.bak-'));
      expect(baks.length).toBe(1);
    } finally {
      client.close();
      await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });
});
