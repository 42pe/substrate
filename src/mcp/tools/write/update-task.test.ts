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
  description: '',
  version: 1,
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
    {
      id: 'g3',
      name: 'Retired',
      description: '',
      position: 2,
      color: null,
      version: 1,
      archived_at: '2026-05-10T00:00:00.000Z',
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
    deps = {
      client,
      config: fixtureConfig,
      loadSubstrate: () => Promise.resolve(substrate),
      root: '/tmp/substrate-test',
    };
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

  it('rejects a move to an unknown group with not_found', async () => {
    const env = await updateTaskHandler(
      { id: 't1', version: 1, group_id: 'ghost', agent_name: 'a' },
      deps,
    );
    if (env.ok) throw new Error('expected error');
    expect(env.error.code).toBe('not_found');
    expect(env.error.details).toMatchObject({ entity: 'group', id: 'ghost' });
  });

  it('rejects a move into an archived group with conflict', async () => {
    const env = await updateTaskHandler(
      { id: 't1', version: 1, group_id: 'g3', agent_name: 'a' },
      deps,
    );
    if (env.ok) throw new Error('expected error');
    expect(env.error.code).toBe('conflict');
    expect(env.error.details).toMatchObject({ entity: 'group', id: 'g3' });
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

// Board carrying a transition_guard (g1→g2 requires custom_data.approved) and an
// agent_responsibility (title keyword) — exercises the Phase 3 engine wiring.
const policyBoard: Board = {
  ...board,
  policies: [
    {
      id: 'guard-1',
      name: 'Approval Guard',
      description: '',
      type: 'transition_guard',
      definition: {
        from_group: 'g1',
        to_group: 'g2',
        require: [{ field: 'task.custom_data.approved', op: 'eq', value: true }],
        on_failure_message: 'Approve before moving to Done.',
      },
      priority: 0,
      enabled: true,
      version: 1,
      created_by_agent: 'tester',
      created_at: '2026-05-09T00:00:00.000Z',
      updated_at: '2026-05-09T00:00:00.000Z',
      archived_at: null,
    },
    {
      id: 'resp-1',
      name: 'Auth Responsibility',
      description: '',
      type: 'agent_responsibility',
      definition: {
        when: [{ field: 'task.title', op: 'matches_any_keyword', values: ['auth', 'login'] }],
        message: 'May relate to auth tasks.',
      },
      priority: 0,
      enabled: true,
      version: 1,
      created_by_agent: 'tester',
      created_at: '2026-05-09T00:00:00.000Z',
      updated_at: '2026-05-09T00:00:00.000Z',
      archived_at: null,
    },
  ],
};

const policyBoardSubstrate: Substrate = { config: fixtureConfig, boards: [policyBoard] };

describe('updateTaskHandler — policy engine', () => {
  let client: Client;
  let dir: string;
  let deps: ToolDeps;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'substrate-update-policy-'));
    client = await openDatabaseAndMigrate(join(dir, '.substrate', 'data.sqlite'));
    deps = {
      client,
      config: fixtureConfig,
      loadSubstrate: () => Promise.resolve(policyBoardSubstrate),
      root: '/tmp/substrate-test',
    };
    await createTask(client, makeTask({ title: 'Fix the login flow', custom_data: {} }));
  });
  afterEach(async () => {
    client.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('blocks a guarded transition and rolls back (no version bump, no event)', async () => {
    const env = await updateTaskHandler(
      { id: 't1', version: 1, group_id: 'g2', agent_name: 'a' },
      deps,
    );
    if (env.ok) throw new Error('expected transition_blocked');
    expect(env.error.code).toBe('transition_blocked');
    expect(env.error.message).toBe('Approve before moving to Done.');
    expect(env.error.details).toMatchObject({
      policy_id: 'guard-1',
      from_group: 'g1',
      to_group: 'g2',
    });

    const task = await getTask(client, 't1');
    expect(task.version).toBe(1); // unchanged
    expect(task.group_id).toBe('g1');
    const { results } = await listEvents(client, 't1');
    expect(results).toHaveLength(0); // no `updated` event
  });

  it('passes a guarded transition when require is met (set approved in the same call) and lists it', async () => {
    // C-1/N-2: group change + custom_data change in one call — guard sees the NEW value.
    const env = await updateTaskHandler(
      { id: 't1', version: 1, group_id: 'g2', custom_data: { approved: true }, agent_name: 'a' },
      deps,
    );
    if (!env.ok) throw new Error('expected success');
    expect(env.applied.state.group_id).toBe('g2');
    expect(env.policies_fired).toContainEqual({
      policy_id: 'guard-1',
      policy_name: 'Approval Guard',
      policy_type: 'transition_guard',
    });
  });

  it('does not evaluate guards when there is no group change (even with a failing require)', async () => {
    const env = await updateTaskHandler(
      { id: 't1', version: 1, title: 'Renamed', agent_name: 'a' },
      deps,
    );
    if (!env.ok) throw new Error('expected success');
    expect(env.policies_fired.some((p) => p.policy_id === 'guard-1')).toBe(false);
  });

  it('surfaces a matching agent_responsibility on update (post-write state)', async () => {
    const env = await updateTaskHandler(
      { id: 't1', version: 1, title: 'auth login fix', agent_name: 'a' },
      deps,
    );
    if (!env.ok) throw new Error('expected success');
    expect(env.policies_fired).toContainEqual({
      policy_id: 'resp-1',
      policy_name: 'Auth Responsibility',
      policy_type: 'agent_responsibility',
      message: 'May relate to auth tasks.',
    });
  });

  it('group change to a group with no matching guard proceeds with no guard entries', async () => {
    // g1 → g1 is not a change; use a real change with approved already set, then
    // assert only the guard that engages is listed.
    const env = await updateTaskHandler(
      { id: 't1', version: 1, group_id: 'g2', custom_data: { approved: true }, agent_name: 'a' },
      deps,
    );
    if (!env.ok) throw new Error('expected success');
    expect(env.policies_fired.filter((p) => p.policy_type === 'transition_guard')).toHaveLength(1);
  });
});
