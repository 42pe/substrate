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
import { createTask } from '../../storage/repositories/tasks.js';
import { resetFileSink } from '../../shared/logger.js';
import { pendingApprovalCommand, renderPendingApprovals } from './pending-approval.js';
import {
  listPendingApprovals,
  type PendingApprovalsResult,
} from '../../operations/list-pending-approvals.js';
import { loadSubstrate } from '../../substrate/loader.js';
import { stripAnsi } from '../color.js';
import type { Board, Config, Task } from '../../core/types.js';

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
  name: 'Delivery',
  description: '',
  field_schema: { task: { plan_approved: { type: 'boolean', human_only: true } }, comments: {} },
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

/** A multi-board fixture for the pure renderer (no DB needed). */
function fixture(): PendingApprovalsResult {
  return {
    project_name: 'Substrate',
    count: 3,
    items: [
      {
        board_id: 'dev',
        board_name: 'dev',
        task_id: 'c607b04e-72a7-49f5-88b6-c82e88dfc594',
        task_title: 'Ship the table',
        group_id: 'build',
        gate: { policy_id: 'g1', policy_name: 'Build gate', to_group: 'review' },
        awaiting_fields: ['plan_approved'],
      },
      {
        board_id: 'dev',
        board_name: 'dev',
        task_id: 'aae8d88f-1111-4111-8111-111111111111',
        task_title: 'Harden markdown',
        group_id: 'review',
        gate: { policy_id: 'g2', policy_name: 'Review gate', to_group: 'approval' },
        awaiting_fields: ['reviews_approved'],
      },
      {
        board_id: 'release',
        board_name: 'release',
        task_id: '12ab34cd-2222-4222-8222-222222222222',
        task_title: 'Cut v0.7.0',
        group_id: 'versioned',
        gate: { policy_id: 'g3', policy_name: 'Release gate', to_group: 'approval' },
        awaiting_fields: ['release_approved'],
      },
    ],
  };
}

describe('renderPendingApprovals (pure)', () => {
  it('renders a count line, both board headers, a column header, and every row', () => {
    const out = renderPendingApprovals(fixture(), { color: false });
    expect(out).toContain('3 task(s) pending human approval in Substrate:');
    expect(out).toContain('\ndev\n');
    expect(out).toContain('\nrelease\n');
    expect(out).toMatch(/Task\s+Move\s+Awaiting\s+Approve/);
    expect(out).toContain('Ship the table');
    expect(out).toContain('Harden markdown');
    expect(out).toContain('Cut v0.7.0');
    // Short id (first 8 chars) is surfaced per task.
    expect(out).toContain('(c607b04e)');
  });

  it('aligns the column header and data rows at the same offsets', () => {
    const out = renderPendingApprovals(fixture(), { color: false });
    const lines = out.split('\n');
    const header = lines.find((l) => /^\s+Task\s+Move/.test(l))!;
    const dataRow = lines.find((l) => l.includes('Ship the table'))!;
    // The Move column starts at the index where 'Move' sits in the header.
    const moveCol = header.indexOf('Move');
    expect(dataRow.slice(moveCol)).toMatch(/^build → review/);
    // The Awaiting column likewise aligns.
    const awaitingCol = header.indexOf('Awaiting');
    expect(dataRow.slice(awaitingCol)).toMatch(/^plan_approved/);
  });

  it('plain mode is escape-free (no ANSI bytes)', () => {
    const out = renderPendingApprovals(fixture(), { color: false });
    expect(out).not.toContain('\x1b[');
  });

  it('color mode adds escapes that strip back to the exact plain render', () => {
    const plain = renderPendingApprovals(fixture(), { color: false });
    const colored = renderPendingApprovals(fixture(), { color: true });
    expect(colored).toContain('\x1b[');
    expect(stripAnsi(colored)).toEqual(plain);
  });

  it('carries a verbatim, runnable approve command per awaiting field', () => {
    const out = renderPendingApprovals(fixture(), { color: false });
    expect(out).toContain('substrate approve c607b04e-72a7-49f5-88b6-c82e88dfc594 plan_approved');
    expect(out).toContain(
      'substrate approve aae8d88f-1111-4111-8111-111111111111 reviews_approved',
    );
  });

  it('stacks one approve line per field for a multi-field gate, staying aligned', () => {
    const result: PendingApprovalsResult = {
      project_name: 'Substrate',
      count: 1,
      items: [
        {
          board_id: 'dev',
          board_name: 'dev',
          task_id: 'deadbeef-0000-4000-8000-000000000000',
          task_title: 'Two-field task',
          group_id: 'build',
          gate: { policy_id: 'g', policy_name: 'g', to_group: 'review' },
          awaiting_fields: ['first_field', 'second_field'],
        },
      ],
    };
    const out = renderPendingApprovals(result, { color: false });
    expect(out).toContain('substrate approve deadbeef-0000-4000-8000-000000000000 first_field');
    expect(out).toContain('substrate approve deadbeef-0000-4000-8000-000000000000 second_field');
    // Awaiting cell joins both field names on the primary row.
    expect(out).toContain('first_field, second_field');
  });

  it('truncates a long title with an ellipsis at a narrow width, keeping the id intact', () => {
    const longTitle = 'A very very very very very very very long task title indeed';
    const result: PendingApprovalsResult = {
      project_name: 'Substrate',
      count: 1,
      items: [
        {
          board_id: 'dev',
          board_name: 'dev',
          task_id: 'abc1234x-0000-4000-8000-000000000000',
          task_title: longTitle,
          group_id: 'build',
          gate: { policy_id: 'g', policy_name: 'g', to_group: 'review' },
          awaiting_fields: ['ok'],
        },
      ],
    };
    const out = renderPendingApprovals(result, { color: false, columns: 60 });
    expect(out).toContain('…');
    expect(out).not.toContain(longTitle); // the full title was clamped
    expect(out).toContain('(abc1234x)'); // the short id survives truncation
  });
});

describe('pendingApprovalCommand', () => {
  let dir: string;
  let client: Client;
  let out: string[];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'substrate-pa-cli-'));
    const root = join(dir, '.substrate');
    await writeConfig(root, config);
    await mkdir(paths(root).boardsDir, { recursive: true });
    await createBoardFile(root, board);
    client = await openDatabaseAndMigrate(paths(root).dataSqlite);
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

  it('lists a pending task grouped by board with the unblock command', async () => {
    await createTask(client, makeTask({ id: 'needsme', title: 'Ship it' }));
    await pendingApprovalCommand(dir);
    const text = out.join('');
    expect(text).toContain('1 task(s) pending human approval');
    expect(text).toContain('Delivery'); // board name
    expect(text).toContain('Ship it');
    expect(text).toContain('plan_approved');
    expect(text).toContain('substrate approve needsme plan_approved');
  });

  it('reports nothing pending when all gates are satisfied', async () => {
    await createTask(client, makeTask({ id: 'ok', custom_data: { plan_approved: true } }));
    await pendingApprovalCommand(dir);
    expect(out.join('')).toContain('No tasks pending human approval');
  });

  // Force the command onto a fake TTY (vitest is non-TTY, so without this the
  // NO_COLOR gate would never be reached and the assertion would be vacuous).
  async function runOnFakeTty(noColor: string | undefined): Promise<void> {
    const origTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    const prev = process.env.NO_COLOR;
    if (noColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = noColor;
    try {
      await pendingApprovalCommand(dir);
    } finally {
      if (origTTY) Object.defineProperty(process.stdout, 'isTTY', origTTY);
      else Reflect.deleteProperty(process.stdout, 'isTTY');
      if (prev === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = prev;
    }
  }

  it('colorizes on a TTY (the gate wires through the command path)', async () => {
    await createTask(client, makeTask({ id: 'needsme', title: 'Ship it' }));
    await runOnFakeTty(undefined);
    expect(out.join('')).toContain('\x1b[');
  });

  it('emits no ANSI escapes on a TTY when NO_COLOR is set', async () => {
    await createTask(client, makeTask({ id: 'needsme', title: 'Ship it' }));
    await runOnFakeTty('1');
    expect(out.join('')).not.toContain('\x1b[');
  });

  it('--json emits the aggregate at parity with listPendingApprovals, no escapes', async () => {
    await createTask(client, makeTask({ id: 'needsme', title: 'Ship it' }));
    await pendingApprovalCommand(dir, { json: true });
    const text = out.join('');
    expect(text).not.toContain('\x1b[');
    const parsed = JSON.parse(text);
    const expected = await listPendingApprovals({
      client,
      loadSubstrate: () => loadSubstrate(join(dir, '.substrate')),
    });
    expect(parsed).toEqual(expected);
  });

  it('--json empty state is valid JSON with count 0 and items []', async () => {
    await pendingApprovalCommand(dir, { json: true });
    const parsed = JSON.parse(out.join(''));
    expect(parsed.count).toBe(0);
    expect(parsed.items).toEqual([]);
  });
});
