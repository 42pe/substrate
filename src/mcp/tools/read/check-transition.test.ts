import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmrf } from '../../../../tests/helpers/tmp.js';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from '@libsql/client';
import { openDatabaseAndMigrate } from '../../../storage/client.js';
import { createTask, getTask } from '../../../storage/repositories/tasks.js';
import { checkTransitionHandler } from './check-transition.js';
import { SubstrateError } from '../../../core/errors.js';
import type { ToolDeps } from '../../deps.js';
import type { Board, Config, Substrate, Task } from '../../../core/types.js';

const config: Config = {
  project_id: '11111111-1111-4111-8111-111111111111',
  project_name: 'P',
  description: '',
  version: 1,
  schema_version: 2,
  created_at: '2026-05-09T00:00:00.000Z',
};

// todo → done requires custom_data.approved to exist.
const board: Board = {
  id: 'b',
  name: 'B',
  description: '',
  field_schema: { task: {}, comments: {} },
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
      id: 'g1',
      name: 'Approval Guard',
      description: '',
      type: 'transition_guard',
      definition: {
        from_group: 'todo',
        to_group: 'done',
        require: [{ field: 'task.custom_data.approved', op: 'exists' }],
        on_failure_message: 'Approve before Done.',
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
const substrate: Substrate = { config, boards: [board] };

function makeTask(over: Partial<Task> = {}): Task {
  return {
    id: 't1',
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

describe('checkTransitionHandler (dry-run)', () => {
  let dir: string;
  let client: Client;
  let deps: ToolDeps;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'substrate-checktr-'));
    client = await openDatabaseAndMigrate(join(dir, 'data.sqlite'));
    deps = { client, config, loadSubstrate: () => Promise.resolve(substrate), root: dir };
    await createTask(client, makeTask());
    await createTask(client, makeTask({ id: 't2', custom_data: { approved: true } }));
  });
  afterEach(async () => {
    client.close();
    await rmrf(dir);
  });

  it('reports BLOCKED when the guard fails (no approval), with the message — no write', async () => {
    const r = await checkTransitionHandler({ task_id: 't1', to_group: 'done' }, deps);
    expect(r.allowed).toBe(false);
    expect(r.from_group).toBe('todo');
    expect(r.blocked_by?.policy_id).toBe('g1');
    expect(r.blocked_by?.message).toMatch(/Approve/);
  });

  it('reports ALLOWED when the guard passes (approval present)', async () => {
    const r = await checkTransitionHandler({ task_id: 't2', to_group: 'done' }, deps);
    expect(r.allowed).toBe(true);
    expect(r.blocked_by).toBeUndefined();
  });

  it('a same-group "move" is allowed without evaluating guards (matches the write path)', async () => {
    // todo→done would be BLOCKED for t1, but a same-group move isn't a transition,
    // so the dry-run must report allowed — exactly as update_task skips guards.
    const r = await checkTransitionHandler({ task_id: 't1', to_group: 'todo' }, deps);
    expect(r.allowed).toBe(true);
    expect(r.blocked_by).toBeUndefined();
  });

  it('an ALLOWED dry-run performs no move — task version + group unchanged', async () => {
    const before = await getTask(client, 't2'); // approved: todo→done would be allowed
    const r = await checkTransitionHandler({ task_id: 't2', to_group: 'done' }, deps);
    expect(r.allowed).toBe(true);
    const after = await getTask(client, 't2');
    expect(after.version).toBe(before.version);
    expect(after.group_id).toBe('todo'); // still in todo — the dry-run didn't move it
  });

  it('not_found on a missing task', async () => {
    await expect(
      checkTransitionHandler({ task_id: 'gone', to_group: 'done' }, deps),
    ).rejects.toBeInstanceOf(SubstrateError);
  });

  it('not_found on a target group that does not exist', async () => {
    await expect(
      checkTransitionHandler({ task_id: 't1', to_group: 'ghost' }, deps),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});
