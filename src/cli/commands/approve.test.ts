import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmrf } from '../../../tests/helpers/tmp.js';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from '@libsql/client';
import { writeConfig } from '../../shared/config.js';
import { paths } from '../../shared/paths.js';
import { createBoardFile } from '../../substrate/writer.js';
import { openDatabaseAndMigrate } from '../../storage/client.js';
import { createTask, getTask } from '../../storage/repositories/tasks.js';
import { listEvents } from '../../storage/repositories/events.js';
import { resetFileSink } from '../../shared/logger.js';
import { approveCommand } from './approve.js';
import { updateTaskHandler } from '../../mcp/tools/write/update-task.js';
import { checkTransitionHandler } from '../../mcp/tools/read/check-transition.js';
import { SubstrateError } from '../../core/errors.js';
import type { Board, Config, Substrate, Task } from '../../core/types.js';
import type { ToolDeps } from '../../mcp/deps.js';

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
      severity: { type: 'enum', values: ['low', 'high'] },
      plan_approved: { type: 'boolean', human_only: true },
    },
    comments: {},
  },
  groups: [
    {
      id: 'g',
      name: 'Group',
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
      id: 'approval-gate',
      name: 'Approval gate',
      description: '',
      type: 'transition_guard',
      definition: {
        from_group: 'g',
        to_group: 'done',
        require: [{ field: 'task.custom_data.plan_approved', op: 'exists' }],
        on_failure_message: 'A human must approve (plan_approved) before Done.',
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
  version: 1,
  created_at: '2026-05-09T00:00:00.000Z',
  updated_at: '2026-05-09T00:00:00.000Z',
  archived_at: null,
};

function makeTask(): Task {
  return {
    id: 't1',
    board_id: 'b',
    group_id: 'g',
    parent_id: null,
    origin_task_id: null,
    title: 'Task',
    description: '',
    custom_data: {},
    version: 1,
    created_by_agent: 'tester',
    created_at: '2026-05-09T00:00:00.000Z',
    updated_at: '2026-05-09T00:00:00.000Z',
    archived_at: null,
  };
}

describe('approveCommand (B3 human channel)', () => {
  let dir: string;
  let client: Client;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'substrate-approve-'));
    const root = join(dir, '.substrate');
    await writeConfig(root, config);
    await mkdir(paths(root).boardsDir, { recursive: true });
    await createBoardFile(root, board);
    client = await openDatabaseAndMigrate(paths(root).dataSqlite);
    await createTask(client, makeTask());
  });
  afterEach(async () => {
    client.close();
    resetFileSink();
    await rmrf(dir);
  });

  it('sets a human_only field and stamps a human actor', async () => {
    await approveCommand(dir, { taskId: 't1', field: 'plan_approved' });
    const t = await getTask(client, 't1');
    expect(t.custom_data['plan_approved']).toBe(true); // default value = true
    expect(t.version).toBe(2);
    const { results } = await listEvents(client, 't1');
    const updated = results.find((e) => e.event_type === 'updated');
    expect(updated?.actor_agent_name).toMatch(/^human:/);
  });

  it('parses a provided value (JSON when possible)', async () => {
    await approveCommand(dir, { taskId: 't1', field: 'plan_approved', value: 'false' });
    const t = await getTask(client, 't1');
    expect(t.custom_data['plan_approved']).toBe(false);
  });

  it('refuses a field that is not human_only (schema_violation)', async () => {
    await expect(
      approveCommand(dir, { taskId: 't1', field: 'severity', value: 'low' }),
    ).rejects.toMatchObject({ code: 'schema_violation' });
  });

  it('not_found on a missing task', async () => {
    await expect(approveCommand(dir, { taskId: 'gone', field: 'plan_approved' })).rejects.toThrow(
      SubstrateError,
    );
  });

  // Headline B3 acceptance: an autonomous agent cannot self-clear a human_only gate
  // end-to-end — it can't set the field, so it can't pass the guard; only the human
  // channel (`substrate approve`) unlocks it, after which the move passes.
  it('end-to-end: agent is blocked until the human approves, then the gate passes', async () => {
    const substrate: Substrate = { config, boards: [board] };
    const deps: ToolDeps = {
      client,
      config,
      loadSubstrate: () => Promise.resolve(substrate),
      root: join(dir, '.substrate'),
    };

    // 1. Agent tries to set the human_only field directly → forbidden.
    const setDirect = await updateTaskHandler(
      { id: 't1', version: 1, custom_data: { plan_approved: true }, agent_name: 'bot' },
      deps,
    );
    if (setDirect.ok) throw new Error('agent should not be able to set a human_only field');
    expect(setDirect.error.code).toBe('forbidden');

    // 2. Agent tries to move to Done without approval → blocked by the guard.
    const moveEarly = await updateTaskHandler(
      { id: 't1', version: 1, group_id: 'done', agent_name: 'bot' },
      deps,
    );
    if (moveEarly.ok) throw new Error('move should be blocked before approval');
    expect(moveEarly.error.code).toBe('transition_blocked');
    // and the dry-run agrees.
    expect((await checkTransitionHandler({ task_id: 't1', to_group: 'done' }, deps)).allowed).toBe(
      false,
    );

    // 3. Human approves via the CLI channel.
    await approveCommand(dir, { taskId: 't1', field: 'plan_approved' });

    // 4. Now the gate passes — dry-run allowed, and the real move succeeds.
    expect((await checkTransitionHandler({ task_id: 't1', to_group: 'done' }, deps)).allowed).toBe(
      true,
    );
    const t2 = await getTask(client, 't1');
    const moveNow = await updateTaskHandler(
      { id: 't1', version: t2.version, group_id: 'done', agent_name: 'bot' },
      deps,
    );
    if (!moveNow.ok) throw new Error('move should succeed after approval');
    expect(moveNow.applied.state.group_id).toBe('done');
  });
});
