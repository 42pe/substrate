import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from '@libsql/client';
import { openDatabaseAndMigrate } from '../../../storage/client.js';
import { createTask, getTask } from '../../../storage/repositories/tasks.js';
import { listEvents } from '../../../storage/repositories/events.js';
import { archiveTask } from '../../../storage/repositories/tasks.js';
import { updateTaskHandler } from './update-task.js';
import type { ToolDeps } from '../../deps.js';
import type { Board, Config, Substrate, Task } from '../../../core/types.js';

const fixtureConfig: Config = {
  project_id: '00000000-0000-4000-8000-000000000001',
  project_name: 'TestProject',
  schema_version: 2,
  created_at: '2026-05-09T00:00:00.000Z',
};

const board: Board = {
  id: 'board-1',
  name: 'Board 1',
  description: '',
  field_schema: { task: { severity: { type: 'enum', values: ['low', 'high'] } }, comments: {} },
  groups: [
    {
      id: 'g1',
      name: 'Todo',
      description: '',
      position: 0,
      color: null,
      version: 1,
      archived_at: null,
    },
    {
      id: 'g2',
      name: 'Done',
      description: '',
      position: 1,
      color: null,
      version: 1,
      archived_at: null,
    },
  ],
  policies: [],
  version: 1,
  created_at: '2026-05-09T00:00:00.000Z',
  updated_at: '2026-05-09T00:00:00.000Z',
  archived_at: null,
};

const substrate: Substrate = { config: fixtureConfig, boards: [board] };

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    board_id: 'board-1',
    group_id: 'g1',
    parent_id: null,
    origin_task_id: null,
    title: 'Original',
    description: 'orig desc',
    custom_data: { severity: 'low' },
    version: 1,
    created_by_agent: 'tester',
    created_at: '2026-05-09T00:00:00.000Z',
    updated_at: '2026-05-09T00:00:00.000Z',
    archived_at: null,
    ...overrides,
  };
}

describe('updateTaskHandler', () => {
  let client: Client;
  let dir: string;
  let deps: ToolDeps;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'substrate-update-task-tool-'));
    client = await openDatabaseAndMigrate(join(dir, '.substrate', 'data.sqlite'));
    deps = { client, config: fixtureConfig, loadSubstrate: () => Promise.resolve(substrate) };
    await createTask(client, makeTask());
  });
  afterEach(async () => {
    client.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('updates fields, bumps version, and emits an updated event with before/after', async () => {
    const env = await updateTaskHandler(
      { id: 't1', version: 1, title: 'New', group_id: 'g2', agent_name: 'a' },
      deps,
    );
    if (!env.ok) throw new Error('expected success');
    expect(env.applied.state.title).toBe('New');
    expect(env.applied.state.group_id).toBe('g2');
    expect(env.applied.version).toBe(2);

    const { results } = await listEvents(client, 't1');
    expect(results).toHaveLength(1);
    expect(results[0]!.event_type).toBe('updated');
    expect(results[0]!.changes).toEqual({
      before: { title: 'Original', group_id: 'g1' },
      after: { title: 'New', group_id: 'g2' },
    });
  });

  it('merges custom_data key-by-key and deletes keys set to null', async () => {
    const env = await updateTaskHandler(
      { id: 't1', version: 1, custom_data: { extra: 1, severity: null }, agent_name: 'a' },
      deps,
    );
    if (!env.ok) throw new Error('expected success');
    expect(env.applied.state.custom_data).toEqual({ extra: 1 }); // severity deleted
  });

  it('rejects custom_data violating field_schema with schema_violation', async () => {
    const env = await updateTaskHandler(
      { id: 't1', version: 1, custom_data: { severity: 'urgent' }, agent_name: 'a' },
      deps,
    );
    if (env.ok) throw new Error('expected error');
    expect(env.error.code).toBe('schema_violation');
  });

  it('rejects a stale version with version_mismatch (no current_version leak)', async () => {
    await updateTaskHandler({ id: 't1', version: 1, title: 'first', agent_name: 'a' }, deps);
    const env = await updateTaskHandler(
      { id: 't1', version: 1, title: 'second', agent_name: 'a' },
      deps,
    );
    if (env.ok) throw new Error('expected error');
    expect(env.error.code).toBe('version_mismatch');
    expect(JSON.stringify(env.error)).not.toContain('current_version');
  });

  it('rejects an update on an archived task with conflict', async () => {
    await archiveTask(client, 't1', 1, '2026-05-10T00:00:00.000Z');
    const env = await updateTaskHandler(
      { id: 't1', version: 2, title: 'x', agent_name: 'a' },
      deps,
    );
    if (env.ok) throw new Error('expected error');
    expect(env.error.code).toBe('conflict');
  });

  it('returns not_found for a missing task', async () => {
    const env = await updateTaskHandler(
      { id: 'nope', version: 1, title: 'x', agent_name: 'a' },
      deps,
    );
    if (env.ok) throw new Error('expected error');
    expect(env.error.code).toBe('not_found');
  });

  it("returns not_found when the task's board is missing from substrate", async () => {
    await createTask(client, makeTask({ id: 't2', board_id: 'gone' }));
    const env = await updateTaskHandler(
      { id: 't2', version: 1, title: 'x', agent_name: 'a' },
      deps,
    );
    if (env.ok) throw new Error('expected error');
    expect(env.error.code).toBe('not_found');
    expect(env.error.details).toMatchObject({ entity: 'board', id: 'gone' });
  });

  it('does not bump version or emit an event when validation fails', async () => {
    await updateTaskHandler(
      { id: 't1', version: 1, custom_data: { severity: 'urgent' }, agent_name: 'a' },
      deps,
    );
    const task = await getTask(client, 't1');
    expect(task.version).toBe(1);
    const { results } = await listEvents(client, 't1');
    expect(results).toHaveLength(0);
  });
});
