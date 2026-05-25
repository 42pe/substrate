import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from '@libsql/client';
import { openDatabaseAndMigrate } from '../client.js';
import { createTask, getTask } from './tasks.js';
import { SubstrateError } from '../../core/errors.js';
import type { Task } from '../../core/types.js';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    board_id: 'board-1',
    group_id: 'group-1',
    parent_id: null,
    origin_task_id: null,
    title: 'Hello',
    description: '',
    custom_data: {},
    version: 1,
    created_by_agent: 'test-agent',
    created_at: '2026-05-09T00:00:00.000Z',
    updated_at: '2026-05-09T00:00:00.000Z',
    archived_at: null,
    ...overrides,
  };
}

describe('tasks repository', () => {
  let client: Client;
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'substrate-tasks-'));
    const dbPath = join(dir, '.substrate', 'data.sqlite');
    client = await openDatabaseAndMigrate(dbPath);
  });

  afterEach(async () => {
    client.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('createTask + getTask round-trips', async () => {
    const t = makeTask();
    await createTask(client, t);
    const read = await getTask(client, t.id);
    expect(read).toEqual(t);
  });

  it('preserves nullable fields as null (not undefined)', async () => {
    const t = makeTask({ parent_id: null, origin_task_id: null, archived_at: null });
    await createTask(client, t);
    const read = await getTask(client, t.id);
    expect(read.parent_id).toBeNull();
    expect(read.origin_task_id).toBeNull();
    expect(read.archived_at).toBeNull();
  });

  it('preserves nullable fields when set to a value', async () => {
    const t = makeTask({
      parent_id: 'parent-1',
      origin_task_id: 'origin-1',
      archived_at: '2026-05-10T00:00:00.000Z',
    });
    await createTask(client, t);
    const read = await getTask(client, t.id);
    expect(read.parent_id).toBe('parent-1');
    expect(read.origin_task_id).toBe('origin-1');
    expect(read.archived_at).toBe('2026-05-10T00:00:00.000Z');
  });

  it('round-trips custom_data through JSON', async () => {
    const t = makeTask({
      custom_data: {
        severity: 'high',
        tags: ['auth', 'login'],
        nested: { a: 1, b: [true, false] },
      },
    });
    await createTask(client, t);
    const read = await getTask(client, t.id);
    expect(read.custom_data).toEqual(t.custom_data);
  });

  it('getTask throws notFound when no row matches', async () => {
    let caught: unknown;
    try {
      await getTask(client, 'no-such-task');
    } catch (e) {
      caught = e;
    }
    expect(SubstrateError.is(caught)).toBe(true);
    if (SubstrateError.is(caught)) {
      expect(caught.code).toBe('not_found');
      expect(caught.details).toEqual({ task_id: 'no-such-task' });
    }
  });

  it('uses parameterized queries (string with quote does not break)', async () => {
    // SQL injection sanity: a title with a single quote should round-trip cleanly
    const t = makeTask({ id: 'task-quoted', title: "Bobby '); DROP TABLE tasks; --" });
    await createTask(client, t);
    const read = await getTask(client, 'task-quoted');
    expect(read.title).toBe("Bobby '); DROP TABLE tasks; --");

    // And the tasks table still exists
    const tables = await client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'",
    );
    expect(tables.rows).toHaveLength(1);
  });
});
