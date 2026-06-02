import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from '@libsql/client';
import { openDatabaseAndMigrate } from '../../../storage/client.js';
import { createTask } from '../../../storage/repositories/tasks.js';
import { listTasksToolHandler } from './list-tasks.js';
import type { ToolDeps } from '../../deps.js';
import type { Board, Config, Task } from '../../../core/types.js';
import { SubstrateError } from '../../../core/errors.js';

const fixtureConfig: Config = {
  project_id: '00000000-0000-4000-8000-000000000001',
  project_name: 'TestProject',
  description: '',
  version: 1,
  schema_version: 2,
  created_at: '2026-05-09T00:00:00.000Z',
};

// Board declares `severity` as a required task field.
const board: Board = {
  id: 'board-1',
  name: 'Board 1',
  description: '',
  field_schema: {
    task: { severity: { type: 'enum', values: ['low', 'high'], required: true } },
    comments: {},
  },
  groups: [],
  policies: [],
  version: 1,
  created_at: '2026-05-09T00:00:00.000Z',
  updated_at: '2026-05-09T00:00:00.000Z',
  archived_at: null,
};

function makeTask(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    board_id: 'board-1',
    group_id: 'g1',
    parent_id: null,
    origin_task_id: null,
    title: `Task ${id}`,
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

describe('listTasksToolHandler', () => {
  let client: Client;
  let dir: string;
  let deps: ToolDeps;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'substrate-list-tasks-tool-'));
    client = await openDatabaseAndMigrate(join(dir, '.substrate', 'data.sqlite'));
    deps = {
      client,
      config: fixtureConfig,
      loadSubstrate: () => Promise.resolve({ config: fixtureConfig, boards: [board] }),
      root: '/tmp/substrate-test',
    };
  });
  afterEach(async () => {
    client.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('lists tasks filtered by board_id', async () => {
    await createTask(client, makeTask('t1'));
    await createTask(client, makeTask('t2', { board_id: 'board-2' }));
    const r = await listTasksToolHandler({ filters: { board_id: 'board-1' } }, deps);
    expect(r.results.map((t) => t.id)).toEqual(['t1']);
  });

  it('missing_required_fields derives required keys from the board schema', async () => {
    await createTask(client, makeTask('with-sev', { custom_data: { severity: 'low' } }));
    await createTask(client, makeTask('without-sev', { custom_data: {} }));
    const r = await listTasksToolHandler(
      { filters: { board_id: 'board-1', missing_required_fields: true } },
      deps,
    );
    expect(r.results.map((t) => t.id)).toEqual(['without-sev']);
  });

  it('missing_required_fields on a board with no required fields returns empty (not all)', async () => {
    // Board 'board-2' declares severity but NOT required.
    const noReqBoard: Board = {
      ...board,
      id: 'board-2',
      field_schema: { task: { severity: { type: 'enum', values: ['low'] } }, comments: {} },
    };
    deps = {
      client,
      config: fixtureConfig,
      loadSubstrate: () => Promise.resolve({ config: fixtureConfig, boards: [noReqBoard] }),
      root: '/tmp/substrate-test',
    };
    await createTask(client, makeTask('t1', { board_id: 'board-2', custom_data: {} }));
    const r = await listTasksToolHandler(
      { filters: { board_id: 'board-2', missing_required_fields: true } },
      deps,
    );
    expect(r.results).toEqual([]);
  });

  it('rejects missing_required_fields without board_id (schema_violation)', async () => {
    let caught: unknown;
    try {
      await listTasksToolHandler({ filters: { missing_required_fields: true } }, deps);
    } catch (e) {
      caught = e;
    }
    expect(SubstrateError.is(caught)).toBe(true);
    if (SubstrateError.is(caught)) {
      expect(caught.code).toBe('schema_violation');
    }
  });

  it('throws not_found when missing_required_fields targets an unknown board', async () => {
    await expect(
      listTasksToolHandler({ filters: { board_id: 'ghost', missing_required_fields: true } }, deps),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('applies a custom_field predicate', async () => {
    await createTask(client, makeTask('hi', { custom_data: { severity: 'high' } }));
    await createTask(client, makeTask('lo', { custom_data: { severity: 'low' } }));
    const r = await listTasksToolHandler(
      { filters: { custom_field: { field: 'severity', op: 'eq', value: 'high' } } },
      deps,
    );
    expect(r.results.map((t) => t.id)).toEqual(['hi']);
  });
});
