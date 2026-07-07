import { describe, it, expect } from 'vitest';
import { runTransitionGuards, runAgentResponsibilities } from './engine.js';
import type { Board, Policy } from '../core/types.js';
import type { EvalContext } from './types.js';
import { SubstrateError } from '../core/errors.js';

function makePolicy(overrides: Partial<Policy> = {}): Policy {
  return {
    id: 'p1',
    name: 'Policy 1',
    description: '',
    type: 'transition_guard',
    definition: {},
    priority: 0,
    enabled: true,
    version: 1,
    created_by_agent: 'tester',
    created_at: '2026-05-09T00:00:00.000Z',
    updated_at: '2026-05-09T00:00:00.000Z',
    archived_at: null,
    ...overrides,
  };
}

function boardWith(policies: Policy[]): Board {
  return {
    id: 'board-1',
    name: 'Board 1',
    description: '',
    field_schema: { task: {}, comments: {} },
    groups: [],
    policies,
    version: 1,
    created_at: '2026-05-09T00:00:00.000Z',
    updated_at: '2026-05-09T00:00:00.000Z',
    archived_at: null,
  };
}

const candidateWithRepro: EvalContext = { task: { custom_data: { repro_steps: 'x' } } };
const candidateWithout: EvalContext = { task: { custom_data: {} } };

describe('runTransitionGuards', () => {
  const guard = (over: Partial<Policy> = {}) =>
    makePolicy({
      type: 'transition_guard',
      definition: {
        from_group: 'todo',
        to_group: 'in_progress',
        require: [{ field: 'task.custom_data.repro_steps', op: 'exists' }],
        on_failure_message: 'Set repro_steps first.',
      },
      ...over,
    });

  it('returns no entries when no guard engages the transition', () => {
    const fired = runTransitionGuards({
      board: boardWith([guard()]),
      fromGroup: 'todo',
      toGroup: 'done', // guard targets in_progress
      candidate: candidateWithout,
    });
    expect(fired).toEqual([]);
  });

  it('a passed guard is silent — not surfaced in the success envelope (B6)', () => {
    const fired = runTransitionGuards({
      board: boardWith([guard({ id: 'g', name: 'Repro Guard' })]),
      fromGroup: 'todo',
      toGroup: 'in_progress',
      candidate: candidateWithRepro,
    });
    // A guard that engages and PASSES enforces by not blocking; it carries no
    // message and is dropped from `policies_fired` to keep the success path clean.
    expect(fired).toEqual([]);
  });

  it('throws transition_blocked with the configured message on failure', () => {
    let caught: unknown;
    try {
      runTransitionGuards({
        board: boardWith([guard({ id: 'g' })]),
        fromGroup: 'todo',
        toGroup: 'in_progress',
        candidate: candidateWithout,
      });
    } catch (e) {
      caught = e;
    }
    expect(SubstrateError.is(caught)).toBe(true);
    if (SubstrateError.is(caught)) {
      expect(caught.code).toBe('transition_blocked');
      expect(caught.message).toBe('Set repro_steps first.');
      expect(caught.details).toEqual({
        policy_id: 'g',
        from_group: 'todo',
        to_group: 'in_progress',
      });
    }
  });

  it('uses a default message when on_failure_message is absent', () => {
    const g = guard({ id: 'g', name: 'NoMsg' });
    (g.definition as Record<string, unknown>)['on_failure_message'] = undefined;
    let caught: unknown;
    try {
      runTransitionGuards({
        board: boardWith([g]),
        fromGroup: 'todo',
        toGroup: 'in_progress',
        candidate: candidateWithout,
      });
    } catch (e) {
      caught = e;
    }
    expect(SubstrateError.is(caught)).toBe(true);
    if (SubstrateError.is(caught)) {
      expect(caught.message).toBe("Policy 'NoMsg' blocks moving from 'todo' to 'in_progress'.");
    }
  });

  it('stops on the first failing guard (priority order); later guard not evaluated', () => {
    const first = guard({ id: 'first', name: 'First', priority: 0 });
    // A second guard that WOULD pass — must not be reached, and must not appear.
    const second = guard({
      id: 'second',
      name: 'Second',
      priority: 1,
      definition: {
        from_group: 'todo',
        to_group: 'in_progress',
        require: [],
        on_failure_message: 'second',
      },
    });
    let caught: unknown;
    try {
      runTransitionGuards({
        board: boardWith([second, first]), // unsorted input
        fromGroup: 'todo',
        toGroup: 'in_progress',
        candidate: candidateWithout,
      });
    } catch (e) {
      caught = e;
    }
    expect(SubstrateError.is(caught) && caught.details?.['policy_id']).toBe('first');
  });

  it('skips disabled and archived guards', () => {
    const disabled = guard({ id: 'd', enabled: false });
    const archived = guard({ id: 'a', archived_at: '2026-05-10T00:00:00.000Z' });
    const fired = runTransitionGuards({
      board: boardWith([disabled, archived]),
      fromGroup: 'todo',
      toGroup: 'in_progress',
      candidate: candidateWithout, // would fail IF evaluated
    });
    expect(fired).toEqual([]); // none engaged → no throw
  });

  it("'*' wildcard guard engages any transition", () => {
    // A passing wildcard is now silent (B6); prove '*' engages ANY transition by
    // making its requirement FAIL — it must block regardless of from/to groups.
    const wild = guard({
      id: 'w',
      definition: {
        from_group: '*',
        to_group: '*',
        require: [{ field: 'task.custom_data.repro_steps', op: 'exists' }],
        on_failure_message: 'blocked',
      },
    });
    expect(() =>
      runTransitionGuards({
        board: boardWith([wild]),
        fromGroup: 'anything',
        toGroup: 'whatever',
        candidate: candidateWithout,
      }),
    ).toThrow(SubstrateError);
  });
});

describe('runAgentResponsibilities', () => {
  const resp = (over: Partial<Policy> = {}) =>
    makePolicy({
      type: 'agent_responsibility',
      definition: {
        when: [{ field: 'task.title', op: 'matches_any_keyword', values: ['auth', 'login'] }],
        message: 'May relate to auth tasks.',
      },
      ...over,
    });

  it('fires matching responsibilities with their message, in priority order', () => {
    const state: EvalContext = { task: { title: 'Fix login' } };
    const a = resp({ id: 'a', name: 'A', priority: 1 });
    const b = resp({
      id: 'b',
      name: 'B',
      priority: 0,
      definition: { when: [], message: 'always' },
    });
    const fired = runAgentResponsibilities({ board: boardWith([a, b]), state });
    expect(fired.map((f) => f.policy_id)).toEqual(['b', 'a']); // priority order
    expect(fired.find((f) => f.policy_id === 'a')?.message).toBe('May relate to auth tasks.');
  });

  it('does not fire non-matching responsibilities', () => {
    const state: EvalContext = { task: { title: 'Unrelated' } };
    const fired = runAgentResponsibilities({ board: boardWith([resp({ id: 'a' })]), state });
    expect(fired).toEqual([]);
  });

  it('empty when always fires', () => {
    const state: EvalContext = { task: { title: 'anything' } };
    const always = resp({ id: 'x', definition: { when: [], message: 'hi' } });
    const fired = runAgentResponsibilities({ board: boardWith([always]), state });
    expect(fired.map((f) => f.policy_id)).toEqual(['x']);
  });

  it('skips disabled, archived, and message-less responsibilities', () => {
    const state: EvalContext = { task: { title: 'login' } };
    const disabled = resp({ id: 'd', enabled: false });
    const archived = resp({ id: 'ar', archived_at: '2026-05-10T00:00:00.000Z' });
    const noMsg = resp({ id: 'n', definition: { when: [] } }); // missing message → no fire
    const fired = runAgentResponsibilities({
      board: boardWith([disabled, archived, noMsg]),
      state,
    });
    expect(fired).toEqual([]);
  });
});
