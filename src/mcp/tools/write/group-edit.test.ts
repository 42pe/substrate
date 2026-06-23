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
import { createTask, archiveTask } from '../../../storage/repositories/tasks.js';
import { createGroupHandler } from './create-group.js';
import { updateGroupHandler } from './update-group.js';
import { reorderGroupsHandler } from './reorder-groups.js';
import { archiveGroupHandler } from './archive-group.js';
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

describe('group edit tools', () => {
  let dir: string;
  let root: string;
  let client: Client;
  let deps: ToolDeps;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'substrate-group-edit-'));
    root = join(dir, '.substrate');
    await writeConfig(root, baseConfig);
    await mkdir(paths(root).boardsDir, { recursive: true });
    client = await openDatabaseAndMigrate(paths(root).dataSqlite);
    await createBoardFile(root, makeBoard('b1', [makeGroup('g1', 0), makeGroup('g2', 1)]));
    deps = { client, config: baseConfig, loadSubstrate: () => loadSubstrate(root), root };
  });
  afterEach(async () => {
    client.close();
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it('create_group appends with the next position', async () => {
    const env = await createGroupHandler({ board_id: 'b1', name: 'New', agent_name: 'a' }, deps);
    if (!env.ok) throw new Error('expected success');
    expect(env.applied.state.position).toBe(2);
    expect(env.applied.version).toBe(1);
  });

  it('create_group on a missing board → not_found', async () => {
    const env = await createGroupHandler({ board_id: 'gone', name: 'X', agent_name: 'a' }, deps);
    if (env.ok) throw new Error('expected error');
    expect(env.error.code).toBe('not_found');
  });

  it('update_group patches + bumps version; locates the board by group id', async () => {
    const env = await updateGroupHandler(
      { id: 'g1', version: 1, name: 'Renamed', agent_name: 'a' },
      deps,
    );
    if (!env.ok) throw new Error('expected success');
    expect(env.applied.state.name).toBe('Renamed');
    expect(env.applied.version).toBe(2);
  });

  it('update_group with a stale version → version_mismatch', async () => {
    await updateGroupHandler({ id: 'g1', version: 1, name: 'A', agent_name: 'a' }, deps);
    const env = await updateGroupHandler(
      { id: 'g1', version: 1, name: 'B', agent_name: 'a' },
      deps,
    );
    if (env.ok) throw new Error('expected error');
    expect(env.error.code).toBe('version_mismatch');
  });

  it('update_group with an id in no board → not_found', async () => {
    const env = await updateGroupHandler(
      { id: 'ghost', version: 1, name: 'X', agent_name: 'a' },
      deps,
    );
    if (env.ok) throw new Error('expected error');
    expect(env.error.code).toBe('not_found');
  });

  it('reorder_groups rewrites positions; rejects a non-permutation', async () => {
    const ok = await reorderGroupsHandler(
      { board_id: 'b1', ordered_ids: ['g2', 'g1'], agent_name: 'a' },
      deps,
    );
    if (!ok.ok) throw new Error('expected success');
    expect(ok.applied.state.map((g) => g.id)).toEqual(['g2', 'g1']);
    expect(ok.applied.state.map((g) => g.position)).toEqual([0, 1]);
    expect(ok.applied.version).toBe(2); // C3: board version returned, not null

    const bad = await reorderGroupsHandler(
      { board_id: 'b1', ordered_ids: ['g1'], agent_name: 'a' },
      deps,
    );
    if (bad.ok) throw new Error('expected error');
    expect(bad.error.code).toBe('schema_violation');
  });

  it('archive_group rejects with conflict when an active task references it', async () => {
    await createTask(client, makeTask('t1', 'g1'));
    const env = await archiveGroupHandler({ id: 'g1', version: 1, agent_name: 'a' }, deps);
    if (env.ok) throw new Error('expected error');
    expect(env.error.code).toBe('conflict');
  });

  it('archive_group succeeds when only archived tasks reference it', async () => {
    await createTask(client, makeTask('t1', 'g1'));
    await archiveTask(client, 't1', 1, '2026-05-10T00:00:00.000Z');
    const env = await archiveGroupHandler({ id: 'g1', version: 1, agent_name: 'a' }, deps);
    if (!env.ok) throw new Error('expected success');
    expect(env.applied.state.archived_at).not.toBeNull();
  });

  it('archive_group is idempotent', async () => {
    const first = await archiveGroupHandler({ id: 'g1', version: 1, agent_name: 'a' }, deps);
    if (!first.ok) throw new Error('expected success');
    const again = await archiveGroupHandler({ id: 'g1', version: 999, agent_name: 'a' }, deps);
    if (!again.ok) throw new Error('expected success');
    expect(again.applied.version).toBe(first.applied.version); // no further bump
  });
});
