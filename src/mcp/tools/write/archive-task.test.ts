import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from '@libsql/client';
import { openDatabaseAndMigrate } from '../../../storage/client.js';
import { createTask } from '../../../storage/repositories/tasks.js';
import { listEvents } from '../../../storage/repositories/events.js';
import { archiveTaskHandler } from './archive-task.js';
import { unarchiveTaskHandler } from './unarchive-task.js';
import type { ToolDeps } from '../../deps.js';
import type { Config, Substrate, Task } from '../../../core/types.js';

const fixtureConfig: Config = {
  project_id: '00000000-0000-4000-8000-000000000001',
  project_name: 'TestProject',
  schema_version: 2,
  created_at: '2026-05-09T00:00:00.000Z',
};

const substrate: Substrate = { config: fixtureConfig, boards: [] };

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    board_id: 'board-1',
    group_id: 'g1',
    parent_id: null,
    origin_task_id: null,
    title: 'T',
    description: '',
    custom_data: {},
    version: 1,
    created_by_agent: 'tester',
    created_at: '2026-05-09T00:00:00.000Z',
    updated_at: '2026-05-09T00:00:00.000Z',
    archived_at: null,
    ...overrides,
  };
}

describe('archiveTaskHandler / unarchiveTaskHandler', () => {
  let client: Client;
  let dir: string;
  let deps: ToolDeps;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'substrate-archive-task-tool-'));
    client = await openDatabaseAndMigrate(join(dir, '.substrate', 'data.sqlite'));
    deps = { client, config: fixtureConfig, loadSubstrate: () => Promise.resolve(substrate) };
    await createTask(client, makeTask());
  });
  afterEach(async () => {
    client.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('archives a task, bumps version, and emits an archived event', async () => {
    const env = await archiveTaskHandler({ id: 't1', version: 1, agent_name: 'a' }, deps);
    if (!env.ok) throw new Error('expected success');
    expect(env.applied.state.archived_at).not.toBeNull();
    expect(env.applied.version).toBe(2);
    const { results } = await listEvents(client, 't1');
    expect(results.map((e) => e.event_type)).toEqual(['archived']);
  });

  it('re-archive is an idempotent no-op that emits no event', async () => {
    await archiveTaskHandler({ id: 't1', version: 1, agent_name: 'a' }, deps);
    const env = await archiveTaskHandler({ id: 't1', version: 2, agent_name: 'a' }, deps);
    if (!env.ok) throw new Error('expected success');
    expect(env.applied.version).toBe(2); // unchanged
    const { results } = await listEvents(client, 't1');
    expect(results).toHaveLength(1); // still just the first archive
  });

  it('unarchive restores and emits an unarchived event', async () => {
    await archiveTaskHandler({ id: 't1', version: 1, agent_name: 'a' }, deps);
    const env = await unarchiveTaskHandler({ id: 't1', version: 2, agent_name: 'a' }, deps);
    if (!env.ok) throw new Error('expected success');
    expect(env.applied.state.archived_at).toBeNull();
    expect(env.applied.version).toBe(3);
    const { results } = await listEvents(client, 't1');
    expect(results.map((e) => e.event_type)).toEqual(['archived', 'unarchived']);
  });

  it('unarchive of a non-archived task is an idempotent no-op (no event)', async () => {
    const env = await unarchiveTaskHandler({ id: 't1', version: 1, agent_name: 'a' }, deps);
    if (!env.ok) throw new Error('expected success');
    const { results } = await listEvents(client, 't1');
    expect(results).toHaveLength(0);
  });

  it('returns not_found for a missing task', async () => {
    const env = await archiveTaskHandler({ id: 'nope', version: 1, agent_name: 'a' }, deps);
    if (env.ok) throw new Error('expected error');
    expect(env.error.code).toBe('not_found');
  });
});
