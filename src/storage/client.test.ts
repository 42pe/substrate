import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabaseAndMigrate, openClient } from './client.js';
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
    await rm(dir, { recursive: true, force: true });
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
    await rm(dir, { recursive: true, force: true });
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
