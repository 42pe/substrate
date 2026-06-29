import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmrf } from '../../../tests/helpers/tmp.js';
import { createClient, type Client } from '@libsql/client';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations, getCurrentSchemaVersion, type Migration } from './runner.js';
import { migration001 } from './001-initial.js';
import { migration002 } from './002-comments-events.js';

async function tempDbClient(): Promise<{ client: Client; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'substrate-mig002-'));
  const client = createClient({ url: `file:${join(dir, 'test.sqlite')}` });
  await client.execute('PRAGMA busy_timeout = 5000');
  return { client, dir };
}

async function tableNames(client: Client): Promise<string[]> {
  const r = await client.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
  return r.rows.map((row) => (row as Record<string, unknown>)['name'] as string);
}

describe('migration 002 (comments + task_events)', () => {
  let client: Client;
  let dir: string;

  beforeEach(async () => {
    const tmp = await tempDbClient();
    client = tmp.client;
    dir = tmp.dir;
  });

  afterEach(async () => {
    client.close();
    await rmrf(dir);
  });

  it('applies on a fresh database (001 then 002) and stamps user_version=2', async () => {
    await runMigrations(client, 2, [migration001, migration002]);
    expect(await getCurrentSchemaVersion(client)).toBe(2);
    const names = await tableNames(client);
    expect(names).toContain('tasks');
    expect(names).toContain('comments');
    expect(names).toContain('task_events');
  });

  it('applies on top of an existing v1 database', async () => {
    await runMigrations(client, 1, [migration001]);
    expect(await getCurrentSchemaVersion(client)).toBe(1);
    await runMigrations(client, 2, [migration001, migration002]);
    expect(await getCurrentSchemaVersion(client)).toBe(2);
    expect(await tableNames(client)).toContain('comments');
  });

  it('task_events.id auto-increments (free ordering)', async () => {
    await runMigrations(client, 2, [migration001, migration002]);
    await client.execute(
      "INSERT INTO task_events (task_id, event_type, changes, actor_agent_name, occurred_at) VALUES ('t','created','{}','a','2026-01-01T00:00:00Z')",
    );
    await client.execute(
      "INSERT INTO task_events (task_id, event_type, changes, actor_agent_name, occurred_at) VALUES ('t','updated','{}','a','2026-01-01T00:00:00Z')",
    );
    const r = await client.execute('SELECT id FROM task_events ORDER BY id');
    const ids = r.rows.map((row) => Number((row as Record<string, unknown>)['id']));
    expect(ids).toEqual([1, 2]);
  });

  it('rolls back cleanly if 002 fails partway', async () => {
    await runMigrations(client, 1, [migration001]);
    const faulty: Migration = {
      id: 2,
      description: '002 that fails after creating comments',
      async up(tx) {
        await tx.execute('CREATE TABLE comments (id TEXT PRIMARY KEY)');
        throw new Error('boom mid-002');
      },
    };
    await expect(runMigrations(client, 2, [migration001, faulty])).rejects.toThrow('boom mid-002');
    // version stayed at 1; comments table rolled back
    expect(await getCurrentSchemaVersion(client)).toBe(1);
    expect(await tableNames(client)).not.toContain('comments');
  });
});
