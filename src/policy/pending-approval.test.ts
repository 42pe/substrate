import { describe, it, expect } from 'vitest';
import { pendingApprovalFor } from './pending-approval.js';
import type { Board, Policy, Task } from '../core/types.js';

function guard(id: string, def: Record<string, unknown>, over: Partial<Policy> = {}): Policy {
  return {
    id,
    name: `Gate ${id}`,
    description: '',
    type: 'transition_guard',
    definition: def,
    priority: 0,
    enabled: true,
    version: 1,
    created_by_agent: 't',
    created_at: '2026-05-09T00:00:00.000Z',
    updated_at: '2026-05-09T00:00:00.000Z',
    archived_at: null,
    ...over,
  };
}

function makeBoard(policies: Policy[], over: Partial<Board> = {}): Board {
  return {
    id: 'b',
    name: 'B',
    description: '',
    field_schema: {
      task: {
        plan_approved: { type: 'boolean', human_only: true },
        tests_passing: { type: 'boolean' }, // agent gate — NOT human_only
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
    policies,
    version: 1,
    created_at: '2026-05-09T00:00:00.000Z',
    updated_at: '2026-05-09T00:00:00.000Z',
    archived_at: null,
    ...over,
  };
}

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

const approvalGate = guard('approval', {
  from_group: 'todo',
  to_group: 'done',
  require: [{ field: 'task.custom_data.plan_approved', op: 'exists' }],
});

describe('pendingApprovalFor', () => {
  it('is pending when a human_only gate field is unset (with gate + awaiting_fields)', () => {
    const r = pendingApprovalFor(makeBoard([approvalGate]), makeTask());
    expect(r.pending).toBe(true);
    expect(r.awaiting_fields).toEqual(['plan_approved']);
    expect(r.gate).toEqual({
      policy_id: 'approval',
      policy_name: 'Gate approval',
      to_group: 'done',
    });
  });

  it('is NOT pending once the human_only field is set', () => {
    const r = pendingApprovalFor(
      makeBoard([approvalGate]),
      makeTask({ custom_data: { plan_approved: true } }),
    );
    expect(r.pending).toBe(false);
    expect(r.awaiting_fields).toEqual([]);
  });

  it('ignores an agent gate (a non-human_only required field)', () => {
    const agentGate = guard('agentg', {
      from_group: 'todo',
      to_group: 'done',
      require: [{ field: 'task.custom_data.tests_passing', op: 'exists' }],
    });
    expect(pendingApprovalFor(makeBoard([agentGate]), makeTask()).pending).toBe(false);
  });

  it('an archived task is never pending', () => {
    const r = pendingApprovalFor(
      makeBoard([approvalGate]),
      makeTask({ archived_at: '2026-05-10T00:00:00.000Z' }),
    );
    expect(r.pending).toBe(false);
  });

  it('a task already in the gate target group is not pending (no-op self-move)', () => {
    const r = pendingApprovalFor(makeBoard([approvalGate]), makeTask({ group_id: 'done' }));
    expect(r.pending).toBe(false);
  });

  it('a disabled or archived guard does not make a task pending', () => {
    const disabled = guard(
      'approval',
      {
        from_group: 'todo',
        to_group: 'done',
        require: [{ field: 'task.custom_data.plan_approved', op: 'exists' }],
      },
      { enabled: false },
    );
    expect(pendingApprovalFor(makeBoard([disabled]), makeTask()).pending).toBe(false);
  });

  it('a board with no human_only fields is never pending', () => {
    const board = makeBoard([approvalGate], {
      field_schema: { task: { plan_approved: { type: 'boolean' } }, comments: {} },
    });
    expect(pendingApprovalFor(board, makeTask()).pending).toBe(false);
  });

  it('a wildcard from-group guard engages from any group', () => {
    const wildcard = guard('w', {
      from_group: '*',
      to_group: 'done',
      require: [{ field: 'task.custom_data.plan_approved', op: 'exists' }],
    });
    const r = pendingApprovalFor(makeBoard([wildcard]), makeTask({ group_id: 'todo' }));
    expect(r.pending).toBe(true);
    expect(r.awaiting_fields).toEqual(['plan_approved']);
  });
});
