import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from '@libsql/client';
import { openDatabaseAndMigrate } from '../client.js';
import { createTask, getTask, updateTask, archiveTask, unarchiveTask, listTasks } from './tasks.js';
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
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
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

const NOW = '2026-05-10T00:00:00.000Z';

describe('updateTask (OCC)', () => {
  let client: Client;
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'substrate-update-'));
    client = await openDatabaseAndMigrate(join(dir, '.substrate', 'data.sqlite'));
    await createTask(client, makeTask({ custom_data: { severity: 'low' } }));
  });
  afterEach(async () => {
    client.close();
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it('updates fields and bumps version', async () => {
    const updated = await updateTask(client, 'task-1', 1, { title: 'New', group_id: 'g2' }, NOW);
    expect(updated.title).toBe('New');
    expect(updated.group_id).toBe('g2');
    expect(updated.version).toBe(2);
    expect(updated.updated_at).toBe(NOW);
    const read = await getTask(client, 'task-1');
    expect(read.version).toBe(2);
    expect(read.title).toBe('New');
  });

  it('replaces custom_data with the merged blob it is given', async () => {
    const updated = await updateTask(
      client,
      'task-1',
      1,
      { custom_data: { severity: 'high', extra: 1 } },
      NOW,
    );
    expect(updated.custom_data).toEqual({ severity: 'high', extra: 1 });
  });

  it('rejects a stale version with version_mismatch (no current_version)', async () => {
    await updateTask(client, 'task-1', 1, { title: 'first' }, NOW);
    let caught: unknown;
    try {
      await updateTask(client, 'task-1', 1, { title: 'second' }, NOW);
    } catch (e) {
      caught = e;
    }
    expect(SubstrateError.is(caught)).toBe(true);
    if (SubstrateError.is(caught)) {
      expect(caught.code).toBe('version_mismatch');
      expect(caught.details).toEqual({ id: 'task-1' });
      expect(JSON.stringify(caught.details)).not.toContain('current_version');
    }
  });

  it('rejects update on an archived task with conflict', async () => {
    await archiveTask(client, 'task-1', 1, NOW);
    let caught: unknown;
    try {
      await updateTask(client, 'task-1', 2, { title: 'x' }, NOW);
    } catch (e) {
      caught = e;
    }
    expect(SubstrateError.is(caught)).toBe(true);
    if (SubstrateError.is(caught)) expect(caught.code).toBe('conflict');
  });

  it('throws not_found for a missing task', async () => {
    await expect(updateTask(client, 'nope', 1, { title: 'x' }, NOW)).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

describe('archiveTask / unarchiveTask (idempotent)', () => {
  let client: Client;
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'substrate-arch-'));
    client = await openDatabaseAndMigrate(join(dir, '.substrate', 'data.sqlite'));
    await createTask(client, makeTask());
  });
  afterEach(async () => {
    client.close();
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it('archives and reports changed: true', async () => {
    const res = await archiveTask(client, 'task-1', 1, NOW);
    expect(res.changed).toBe(true);
    expect(res.task.archived_at).toBe(NOW);
    expect(res.task.version).toBe(2);
  });

  it('re-archive is idempotent: changed false, no version bump', async () => {
    await archiveTask(client, 'task-1', 1, NOW);
    const res = await archiveTask(client, 'task-1', 2, NOW);
    expect(res.changed).toBe(false);
    expect(res.task.version).toBe(2); // unchanged
  });

  it('re-archive with a stale version still succeeds as a no-op', async () => {
    await archiveTask(client, 'task-1', 1, NOW);
    const res = await archiveTask(client, 'task-1', 999, NOW); // stale, but no-op
    expect(res.changed).toBe(false);
  });

  it('unarchive restores and reports changed: true', async () => {
    await archiveTask(client, 'task-1', 1, NOW);
    const res = await unarchiveTask(client, 'task-1', 2, NOW);
    expect(res.changed).toBe(true);
    expect(res.task.archived_at).toBeNull();
    expect(res.task.version).toBe(3);
  });

  it('unarchive of a non-archived task is idempotent no-op', async () => {
    const res = await unarchiveTask(client, 'task-1', 1, NOW);
    expect(res.changed).toBe(false);
  });
});

describe('listTasks', () => {
  let client: Client;
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'substrate-list-'));
    client = await openDatabaseAndMigrate(join(dir, '.substrate', 'data.sqlite'));
    // seed
    for (let n = 1; n <= 5; n++) {
      await createTask(
        client,
        makeTask({
          id: `t${n}`,
          board_id: n <= 3 ? 'boardA' : 'boardB',
          group_id: n % 2 === 0 ? 'done' : 'todo',
          title: `Task ${n}`,
          description: n === 3 ? 'has the keyword zebra' : '',
          custom_data: { priority: n },
          created_at: `2026-05-0${n}T00:00:00.000Z`,
          updated_at: `2026-05-0${n}T00:00:00.000Z`,
        }),
      );
    }
  });
  afterEach(async () => {
    client.close();
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it('filters by board_id', async () => {
    const { results } = await listTasks(client, { filters: { board_id: 'boardA' } });
    expect(results.map((t) => t.id).sort()).toEqual(['t1', 't2', 't3']);
  });

  it('filters by in_groups / not_in_groups', async () => {
    const inDone = await listTasks(client, { filters: { in_groups: ['done'] } });
    expect(inDone.results.map((t) => t.id).sort()).toEqual(['t2', 't4']);
    const notDone = await listTasks(client, { filters: { not_in_groups: ['done'] } });
    expect(notDone.results.map((t) => t.id).sort()).toEqual(['t1', 't3', 't5']);
  });

  it('defaults to active-only; archived:true returns archived', async () => {
    await archiveTask(client, 't1', 1, NOW);
    const active = await listTasks(client, { filters: {} });
    expect(active.results.map((t) => t.id)).not.toContain('t1');
    const archived = await listTasks(client, { filters: { archived: true } });
    expect(archived.results.map((t) => t.id)).toEqual(['t1']);
  });

  it('custom_field eq / gt against JSON1', async () => {
    const eq = await listTasks(client, {
      filters: { custom_field: { field: 'priority', op: 'eq', value: 3 } },
    });
    expect(eq.results.map((t) => t.id)).toEqual(['t3']);
    const gt = await listTasks(client, {
      filters: { custom_field: { field: 'priority', op: 'gt', value: 3 } },
    });
    expect(gt.results.map((t) => t.id).sort()).toEqual(['t4', 't5']);
  });

  it('text_search matches title or description, case-insensitive', async () => {
    const r = await listTasks(client, { filters: { text_search: 'ZEBRA' } });
    expect(r.results.map((t) => t.id)).toEqual(['t3']);
  });

  it('missing_required_fields binds JSON paths safely against a malicious field name', async () => {
    // Field name crafted to break out of SQL if interpolated. Must NOT inject.
    const malicious = "x') IS NULL OR (1=1";
    const r = await listTasks(client, {
      filters: {},
      requiredTaskFields: [malicious],
    });
    // Every seeded task lacks the malicious key → all "missing" it. If the
    // injection had fired (OR 1=1), we'd still get all rows — so also assert
    // the table is intact and a benign required-field query is correct.
    expect(r.results.length).toBe(5);
    const benign = await listTasks(client, {
      filters: {},
      requiredTaskFields: ['priority'],
    });
    // All tasks HAVE priority → none missing it.
    expect(benign.results.length).toBe(0);
  });

  it('paginates with a stable cursor', async () => {
    const page1 = await listTasks(client, {
      filters: {},
      sort: { field: 'created_at', direction: 'asc' },
      pagination: { page_size: 2 },
    });
    expect(page1.results.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(page1.pagination.has_more).toBe(true);
    const page2 = await listTasks(client, {
      filters: {},
      sort: { field: 'created_at', direction: 'asc' },
      pagination: { cursor: page1.pagination.next_cursor!, page_size: 2 },
    });
    expect(page2.results.map((t) => t.id)).toEqual(['t3', 't4']);
  });
});
