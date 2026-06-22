import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from '@libsql/client';
import { writeConfig } from '../../../shared/config.js';
import { paths } from '../../../shared/paths.js';
import { createBoardFile } from '../../../substrate/writer.js';
import { loadSubstrate } from '../../../substrate/loader.js';
import { openDatabaseAndMigrate } from '../../../storage/client.js';
import { createTask } from '../../../storage/repositories/tasks.js';
import { createPolicyHandler } from './create-policy.js';
import { updatePolicyHandler } from './update-policy.js';
import { archivePolicyHandler } from './archive-policy.js';
import { updateTaskHandler } from './update-task.js';
import type { ToolDeps } from '../../deps.js';
import type { Board, Config, Group, Task } from '../../../core/types.js';

const baseConfig: Config = {
  project_id: '11111111-1111-4111-8111-111111111111',
  project_name: 'Proj',
  description: '',
  version: 1,
  schema_version: 2,
  created_at: '2026-05-09T00:00:00.000Z',
};

function makeGroup(id: string, position: number): Group {
  return { id, name: id, description: '', position, color: null, version: 1, archived_at: null };
}

function makeBoard(id: string, groups: Group[]): Board {
  return {
    id,
    name: `Board ${id}`,
    description: '',
    field_schema: { task: {}, comments: {} },
    groups,
    policies: [],
    version: 1,
    created_at: '2026-05-09T00:00:00.000Z',
    updated_at: '2026-05-09T00:00:00.000Z',
    archived_at: null,
  };
}

function makeTask(id: string, groupId: string): Task {
  return {
    id,
    board_id: 'b1',
    group_id: groupId,
    parent_id: null,
    origin_task_id: null,
    title: 't',
    description: '',
    custom_data: {},
    version: 1,
    created_by_agent: 'tester',
    created_at: '2026-05-09T00:00:00.000Z',
    updated_at: '2026-05-09T00:00:00.000Z',
    archived_at: null,
  };
}

describe('policy edit tools', () => {
  let dir: string;
  let root: string;
  let client: Client;
  let deps: ToolDeps;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'substrate-policy-edit-'));
    root = join(dir, '.substrate');
    await writeConfig(root, baseConfig);
    await mkdir(paths(root).boardsDir, { recursive: true });
    client = await openDatabaseAndMigrate(paths(root).dataSqlite);
    await createBoardFile(root, makeBoard('b1', [makeGroup('todo', 0), makeGroup('done', 1)]));
    deps = { client, config: baseConfig, loadSubstrate: () => loadSubstrate(root), root };
  });
  afterEach(async () => {
    client.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('create_policy appends a policy', async () => {
    const env = await createPolicyHandler(
      {
        board_id: 'b1',
        name: 'Guard',
        type: 'transition_guard',
        definition: { from_group: 'todo', to_group: 'done', require: [] },
        agent_name: 'a',
      },
      deps,
    );
    if (!env.ok) throw new Error('expected success');
    expect(env.applied.entity).toBe('policy');
    expect(env.applied.state.type).toBe('transition_guard');
    expect(env.applied.version).toBe(1);
  });

  it('create_policy rejects a malformed guard definition with schema_violation', async () => {
    const env = await createPolicyHandler(
      {
        board_id: 'b1',
        name: 'P',
        type: 'transition_guard',
        definition: { from_group: 'todo' },
        agent_name: 'a',
      },
      deps,
    );
    if (env.ok) throw new Error('expected error');
    expect(env.error.code).toBe('schema_violation');
  });

  it('create_policy rejects an agent_responsibility with no message', async () => {
    const env = await createPolicyHandler(
      { board_id: 'b1', name: 'P', type: 'agent_responsibility', definition: {}, agent_name: 'a' },
      deps,
    );
    if (env.ok) throw new Error('expected error');
    expect(env.error.code).toBe('schema_violation');
  });

  it('create_policy rejects an unknown key in a leaf condition', async () => {
    const env = await createPolicyHandler(
      {
        board_id: 'b1',
        name: 'P',
        type: 'transition_guard',
        definition: {
          from_group: 'todo',
          to_group: 'done',
          require: [{ field: 'task.x', op: 'eq', valeu: 1 }],
        },
        agent_name: 'a',
      },
      deps,
    );
    if (env.ok) throw new Error('expected error');
    expect(env.error.code).toBe('schema_violation');
  });

  it('update_policy rejects replacing a definition with a malformed one', async () => {
    const created = await createPolicyHandler(
      {
        board_id: 'b1',
        name: 'P',
        type: 'transition_guard',
        definition: { from_group: 'todo', to_group: 'done' },
        agent_name: 'a',
      },
      deps,
    );
    if (!created.ok) throw new Error('expected success');
    const env = await updatePolicyHandler(
      { id: created.applied.id, version: 1, definition: { to_group: 'done' }, agent_name: 'a' },
      deps,
    );
    if (env.ok) throw new Error('expected error');
    expect(env.error.code).toBe('schema_violation');
  });

  it('update_policy rejects a type change with schema_violation', async () => {
    const created = await createPolicyHandler(
      {
        board_id: 'b1',
        name: 'P',
        type: 'transition_guard',
        definition: { from_group: 'todo', to_group: 'done' },
        agent_name: 'a',
      },
      deps,
    );
    if (!created.ok) throw new Error('expected success');
    const env = await updatePolicyHandler(
      { id: created.applied.id, version: 1, type: 'agent_responsibility', agent_name: 'a' },
      deps,
    );
    if (env.ok) throw new Error('expected error');
    expect(env.error.code).toBe('schema_violation');
  });

  it('update_policy patches definition + bumps version', async () => {
    const created = await createPolicyHandler(
      {
        board_id: 'b1',
        name: 'P',
        type: 'transition_guard',
        definition: { from_group: 'todo', to_group: 'done' },
        agent_name: 'a',
      },
      deps,
    );
    if (!created.ok) throw new Error('expected success');
    const env = await updatePolicyHandler(
      { id: created.applied.id, version: 1, enabled: false, agent_name: 'a' },
      deps,
    );
    if (!env.ok) throw new Error('expected success');
    expect(env.applied.state.enabled).toBe(false);
    expect(env.applied.version).toBe(2);
  });

  it('archive_policy is idempotent', async () => {
    const created = await createPolicyHandler(
      {
        board_id: 'b1',
        name: 'P',
        type: 'transition_guard',
        definition: { from_group: 'todo', to_group: 'done' },
        agent_name: 'a',
      },
      deps,
    );
    if (!created.ok) throw new Error('expected success');
    const first = await archivePolicyHandler(
      { id: created.applied.id, version: 1, agent_name: 'a' },
      deps,
    );
    if (!first.ok) throw new Error('expected success');
    const again = await archivePolicyHandler(
      { id: created.applied.id, version: 999, agent_name: 'a' },
      deps,
    );
    if (!again.ok) throw new Error('expected success');
    expect(again.applied.version).toBe(first.applied.version);
  });

  it('a transition_guard authored via create_policy is enforced by update_task', async () => {
    // Author a guard: todo→done requires custom_data.approved.
    await createPolicyHandler(
      {
        board_id: 'b1',
        name: 'Approval',
        type: 'transition_guard',
        definition: {
          from_group: 'todo',
          to_group: 'done',
          require: [{ field: 'task.custom_data.approved', op: 'eq', value: true }],
          on_failure_message: 'Approve first.',
        },
        agent_name: 'a',
      },
      deps,
    );
    await createTask(client, makeTask('t1', 'todo'));

    // The freshly-authored policy is loaded + engaged by the engine.
    const blocked = await updateTaskHandler(
      { id: 't1', version: 1, group_id: 'done', agent_name: 'a' },
      deps,
    );
    if (blocked.ok) throw new Error('expected transition_blocked');
    expect(blocked.error.code).toBe('transition_blocked');
    expect(blocked.error.message).toBe('Approve first.');
  });
});
