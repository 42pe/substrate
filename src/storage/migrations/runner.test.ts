import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getCurrentSchemaVersion, runMigrations, migrations, type Migration } from './runner.js';
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
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('returns the stamped version after migration', async () => {
    const { client, dir } = await tempDbClient();
    try {
      await client.execute('PRAGMA user_version = 42');
      expect(await getCurrentSchemaVersion(client)).toBe(42);
    } finally {
      client.close();
      await rm(dir, { recursive: true, force: true });
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
    await rm(dir, { recursive: true, force: true });
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

    // First bring up to v1 cleanly
    await runMigrations(client, 1);
    expect(await getCurrentSchemaVersion(client)).toBe(1);

    // Now patch the migrations list locally for this test only
    const originalLength = migrations.length;
    (migrations as Migration[]).push(faulty);

    try {
      let caught: unknown;
      try {
        await runMigrations(client, 2);
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
    } finally {
      // Restore migrations array for other tests
      (migrations as Migration[]).length = originalLength;
    }
  });
});
