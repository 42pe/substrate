import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
import { unapproveCommand } from './unapprove.js';
import { checkTransitionHandler } from '../../mcp/tools/read/check-transition.js';
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

// Board carries: a non-human_only field (severity), a human_only field behind an
// `exists` gate (plan_approved, g→done) and a human_only field behind an
// `eq true` gate (release_approved, review→approved).
const board: Board = {
  id: 'b',
  name: 'Board B',
  description: '',
  field_schema: {
    task: {
      severity: { type: 'enum', values: ['low', 'high'] },
      plan_approved: { type: 'boolean', human_only: true },
      release_approved: { type: 'boolean', human_only: true },
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
    {
      id: 'review',
      name: 'Review',
      description: '',
      position: 2,
      color: null,
      version: 1,
      archived_at: null,
    },
    {
      id: 'approved',
      name: 'Approved',
      description: '',
      position: 3,
      color: null,
      version: 1,
      archived_at: null,
    },
  ],
  policies: [
    {
      id: 'exists-gate',
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
    {
      id: 'eq-gate',
      name: 'Release gate',
      description: '',
      type: 'transition_guard',
      definition: {
        from_group: 'review',
        to_group: 'approved',
        require: [{ field: 'task.custom_data.release_approved', op: 'eq', value: true }],
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

function makeTask(over: Partial<Task> = {}): Task {
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
    ...over,
  };
}

describe('unapproveCommand (revoke a human approval)', () => {
  let dir: string;
  let client: Client;
  let deps: ToolDeps;
  let out: string[];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'substrate-unapprove-'));
    const root = join(dir, '.substrate');
    await writeConfig(root, config);
    await mkdir(paths(root).boardsDir, { recursive: true });
    await createBoardFile(root, board);
    client = await openDatabaseAndMigrate(paths(root).dataSqlite);
    const substrate: Substrate = { config, boards: [board], members: [], warnings: [] };
    deps = { client, config, loadSubstrate: () => Promise.resolve(substrate), root };
    out = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      out.push(String(chunk));
      return true;
    });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    resetFileSink();
    client.close();
    await rmrf(dir);
  });

  const allowed = (taskId: string, toGroup: string): Promise<boolean> =>
    checkTransitionHandler({ task_id: taskId, to_group: toGroup }, deps).then((r) => r.allowed);

  it('re-blocks an `exists` gate: revoke deletes the field (not sets false)', async () => {
    await createTask(client, makeTask());
    await approveCommand(dir, { taskId: 't1', field: 'plan_approved' });
    expect(await allowed('t1', 'done')).toBe(true);

    await unapproveCommand(dir, { taskId: 't1', field: 'plan_approved' });
    expect(await allowed('t1', 'done')).toBe(false); // gate re-blocks
    const t = await getTask(client, 't1');
    expect('plan_approved' in t.custom_data).toBe(false); // deleted, not `false`
  });

  it('re-blocks an `eq true` gate as well', async () => {
    await createTask(client, makeTask({ id: 't2', group_id: 'review' }));
    await approveCommand(dir, { taskId: 't2', field: 'release_approved' });
    expect(await allowed('t2', 'approved')).toBe(true);

    await unapproveCommand(dir, { taskId: 't2', field: 'release_approved' });
    expect(await allowed('t2', 'approved')).toBe(false);
    const t = await getTask(client, 't2');
    expect('release_approved' in t.custom_data).toBe(false);
  });

  it('stamps a human actor and an event whose before has the field, after does not', async () => {
    await createTask(client, makeTask());
    await approveCommand(dir, { taskId: 't1', field: 'plan_approved' });
    await unapproveCommand(dir, { taskId: 't1', field: 'plan_approved' });

    const { results } = await listEvents(client, 't1');
    const updates = results.filter((e) => e.event_type === 'updated');
    const revoke = updates[updates.length - 1];
    expect(revoke?.actor_agent_name).toMatch(/^human:/);
    // `changes` is `Record<string, unknown>`, so reach into it by bracket-access
    // with a cast (the codebase idiom) rather than dotted member access.
    const side = (key: 'before' | 'after'): Record<string, unknown> =>
      (revoke?.changes[key] as { custom_data?: Record<string, unknown> } | undefined)
        ?.custom_data ?? {};
    expect('plan_approved' in side('before')).toBe(true);
    expect('plan_approved' in side('after')).toBe(false);
  });

  it('bumps the version and prints the old value + cleared + new version', async () => {
    await createTask(client, makeTask());
    await approveCommand(dir, { taskId: 't1', field: 'plan_approved' }); // version → 2
    out.length = 0;
    await unapproveCommand(dir, { taskId: 't1', field: 'plan_approved' }); // version → 3
    const t = await getTask(client, 't1');
    expect(t.version).toBe(3);
    const text = out.join('');
    expect(text).toContain('Revoked: cleared plan_approved (was true)');
    expect(text).toContain('version 3');
  });

  it('refuses a field that is not human_only (schema_violation) and changes nothing', async () => {
    await createTask(client, makeTask({ custom_data: { severity: 'low' } }));
    await expect(unapproveCommand(dir, { taskId: 't1', field: 'severity' })).rejects.toMatchObject({
      code: 'schema_violation',
    });
    const t = await getTask(client, 't1');
    expect(t.version).toBe(1); // guard-before-write + rollback: nothing touched
    expect(t.custom_data['severity']).toBe('low');
  });

  it('is a friendly no-op when the field is not set (no write, no event)', async () => {
    await createTask(client, makeTask());
    const before = (await listEvents(client, 't1')).results.length;
    await unapproveCommand(dir, { taskId: 't1', field: 'plan_approved' });
    const text = out.join('');
    expect(text).toContain('Nothing to revoke: plan_approved is not set on task t1.');
    const t = await getTask(client, 't1');
    expect(t.version).toBe(1); // unchanged
    const after = (await listEvents(client, 't1')).results;
    expect(after.length).toBe(before); // no event appended
    expect(after.some((e) => e.event_type === 'updated')).toBe(false);
  });

  it('throws not_found on a missing task', async () => {
    await expect(
      unapproveCommand(dir, { taskId: 'gone', field: 'plan_approved' }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('warns (without a fake move command) when the task is stranded past the gate', async () => {
    // Task already sits in the gate's to_group with the approval set (as if it
    // moved past the gate on the mistaken approval).
    await createTask(client, makeTask({ group_id: 'done', custom_data: { plan_approved: true } }));
    await unapproveCommand(dir, { taskId: 't1', field: 'plan_approved' });
    const text = out.join('');
    expect(text).toContain('Warning:');
    expect(text).toContain("group 'done'");
    expect(text).toContain('unapprove does not move tasks');
    expect(text).not.toContain('substrate move'); // no fabricated CLI verb
    const t = await getTask(client, 't1');
    expect(t.group_id).toBe('done'); // never moved
  });

  it('does not warn when the task has not passed the gate', async () => {
    await createTask(client, makeTask()); // group 'g', not the to_group
    await approveCommand(dir, { taskId: 't1', field: 'plan_approved' });
    out.length = 0;
    await unapproveCommand(dir, { taskId: 't1', field: 'plan_approved' });
    expect(out.join('')).not.toContain('Warning:');
  });

  it('full round-trip: approve → allowed → unapprove → blocked → approve → allowed', async () => {
    await createTask(client, makeTask());
    await approveCommand(dir, { taskId: 't1', field: 'plan_approved' });
    expect(await allowed('t1', 'done')).toBe(true);
    await unapproveCommand(dir, { taskId: 't1', field: 'plan_approved' });
    expect(await allowed('t1', 'done')).toBe(false);
    await approveCommand(dir, { taskId: 't1', field: 'plan_approved' });
    expect(await allowed('t1', 'done')).toBe(true);
  });
});
