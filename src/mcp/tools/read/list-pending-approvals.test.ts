import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmrf } from '../../../../tests/helpers/tmp.js';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from '@libsql/client';
import { openDatabaseAndMigrate } from '../../../storage/client.js';
import { createTask } from '../../../storage/repositories/tasks.js';
import { listPendingApprovalsHandler } from './list-pending-approvals.js';
import type { ToolDeps } from '../../deps.js';
import type { Board, Config, Substrate, Task } from '../../../core/types.js';

const config: Config = {
  project_id: '11111111-1111-4111-8111-111111111111',
  project_name: 'Proj',
  description: '',
  version: 1,
  schema_version: 2,
  created_at: '2026-05-09T00:00:00.000Z',
};

const board: Board = {
  id: 'b',
  name: 'Board B',
  description: '',
  field_schema: {
    task: {
      plan_approved: { type: 'boolean', human_only: true },
      tests_passing: { type: 'boolean' },
    },
    comments: {},
  },
  groups: [
    {
      id: 'todo',
      name: 'Todo',
      description: '',
      position: 0,
      color: null,
      version: 1,
      archived_at: null,
    },
    {
      id: 'done',
      name: 'Done',
      description: '',
      position: 1,
      color: null,
      version: 1,
      archived_at: null,
    },
  ],
  policies: [
    {
      id: 'gate',
      name: 'Approval gate',
      description: '',
      type: 'transition_guard',
      definition: {
        from_group: 'todo',
        to_group: 'done',
        require: [{ field: 'task.custom_data.plan_approved', op: 'exists' }],
      },
      priority: 0,
      enabled: true,
      version: 1,
      created_by_agent: 't',
      created_at: '2026-05-09T00:00:00.000Z',
      updated_at: '2026-05-09T00:00:00.000Z',
      archived_at: null,
    },
  ],
  version: 1,
  created_at: '2026-05-09T00:00:00.000Z',
  updated_at: '2026-05-09T00:00:00.000Z',
  archived_at: null,
};
const substrate: Substrate = { config, boards: [board], members: [], warnings: [] };

function makeTask(over: Partial<Task>): Task {
  return {
    id: 't',
    board_id: 'b',
    group_id: 'todo',
    parent_id: null,
    origin_task_id: null,
    title: 't',
    description: '',
    custom_data: {},
    version: 1,
    created_by_agent: 't',
    created_at: '2026-05-09T00:00:00.000Z',
    updated_at: '2026-05-09T00:00:00.000Z',
    archived_at: null,
    ...over,
  };
}

describe('list_pending_approvals', () => {
  let dir: string;
  let client: Client;
  let deps: ToolDeps;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'substrate-pending-'));
    client = await openDatabaseAndMigrate(join(dir, 'data.sqlite'));
    deps = { client, config, loadSubstrate: () => Promise.resolve(substrate), root: dir };
    await createTask(client, makeTask({ id: 'pending', title: 'Needs sign-off' }));
    await createTask(client, makeTask({ id: 'approved', custom_data: { plan_approved: true } }));
    // already advanced past the gate (in 'done') → not pending
    await createTask(client, makeTask({ id: 'shipped', group_id: 'done' }));
    await createTask(client, makeTask({ id: 'archived', archived_at: '2026-05-10T00:00:00.000Z' }));
  });
  afterEach(async () => {
    client.close();
    await rmrf(dir);
  });

  it('returns exactly the tasks blocked on an unset human_only field', async () => {
    const r = await listPendingApprovalsHandler({}, deps);
    expect(r.count).toBe(1);
    expect(r.items.map((i) => i.task_id)).toEqual(['pending']);
    const item = r.items[0]!;
    expect(item.task_title).toBe('Needs sign-off');
    expect(item.gate).toEqual({
      policy_id: 'gate',
      policy_name: 'Approval gate',
      to_group: 'done',
    });
    expect(item.awaiting_fields).toEqual(['plan_approved']);
    expect(r.project_name).toBe('Proj');
  });

  it('scopes to a board_id when given', async () => {
    const r = await listPendingApprovalsHandler({ board_id: 'b' }, deps);
    expect(r.count).toBe(1);
  });

  it('not_found on an unknown board_id', async () => {
    await expect(listPendingApprovalsHandler({ board_id: 'ghost' }, deps)).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});
