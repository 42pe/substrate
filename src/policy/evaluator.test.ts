import { describe, it, expect } from 'vitest';
import { resolveField, evaluateCondition, evaluateConditions } from './evaluator.js';
import type { Condition, EvalContext } from './types.js';

const ctx: EvalContext = {
  task: {
    title: 'Fix login',
    group_id: 'todo',
    priority: undefined, // not present literally
    custom_data: { priority: 'high', severity: 'low', repro_steps: 'click x' },
  },
};

describe('resolveField — literal-then-custom_data fallback', () => {
  it('resolves a literal top-level field', () => {
    expect(resolveField('task.title', ctx)).toBe('Fix login');
    expect(resolveField('task.group_id', ctx)).toBe('todo');
  });

  it('falls back to custom_data when the literal path is absent', () => {
    expect(resolveField('task.priority', ctx)).toBe('high'); // task.priority absent → custom_data.priority
    expect(resolveField('task.repro_steps', ctx)).toBe('click x');
  });

  it('resolves an explicit custom_data path literally (no fallback)', () => {
    expect(resolveField('task.custom_data.severity', ctx)).toBe('low');
  });

  it('returns undefined for an unresolvable path (and never throws)', () => {
    expect(resolveField('task.nope', ctx)).toBeUndefined();
    expect(resolveField('task.custom_data.nope', ctx)).toBeUndefined();
    expect(resolveField('comment.body', ctx)).toBeUndefined(); // root not in context
    expect(resolveField('', ctx)).toBeUndefined();
    expect(resolveField('task', ctx)).toBe(ctx.task); // bare root → whole object
  });

  it('literal takes precedence over the custom_data fallback', () => {
    const c: EvalContext = {
      task: { priority: 'literal-wins', custom_data: { priority: 'nested' } },
    };
    expect(resolveField('task.priority', c)).toBe('literal-wins');
  });
});

describe('evaluateCondition — leaf', () => {
  it('resolves the field then applies the operator', () => {
    expect(
      evaluateCondition({ field: 'task.custom_data.severity', op: 'eq', value: 'low' }, ctx),
    ).toBe(true);
    expect(evaluateCondition({ field: 'task.repro_steps', op: 'exists' }, ctx)).toBe(true);
    expect(evaluateCondition({ field: 'task.nope', op: 'exists' }, ctx)).toBe(false);
    expect(
      evaluateCondition({ field: 'task.title', op: 'matches_any_keyword', values: ['login'] }, ctx),
    ).toBe(true);
  });
});

describe('evaluateCondition — compound', () => {
  const hi: Condition = { field: 'task.custom_data.priority', op: 'eq', value: 'high' };
  const lo: Condition = { field: 'task.custom_data.severity', op: 'eq', value: 'low' };
  const wrong: Condition = { field: 'task.title', op: 'eq', value: 'nope' };

  it('all_of', () => {
    expect(evaluateCondition({ all_of: [hi, lo] }, ctx)).toBe(true);
    expect(evaluateCondition({ all_of: [hi, wrong] }, ctx)).toBe(false);
  });
  it('any_of', () => {
    expect(evaluateCondition({ any_of: [wrong, lo] }, ctx)).toBe(true);
    expect(evaluateCondition({ any_of: [wrong] }, ctx)).toBe(false);
  });
  it('none_of', () => {
    expect(evaluateCondition({ none_of: [wrong] }, ctx)).toBe(true);
    expect(evaluateCondition({ none_of: [hi] }, ctx)).toBe(false);
  });
  it('nesting', () => {
    expect(evaluateCondition({ all_of: [hi, { any_of: [wrong, lo] }] }, ctx)).toBe(true);
  });

  it('empty-set semantics: all_of=true, any_of=false, none_of=true', () => {
    expect(evaluateCondition({ all_of: [] }, ctx)).toBe(true);
    expect(evaluateCondition({ any_of: [] }, ctx)).toBe(false);
    expect(evaluateCondition({ none_of: [] }, ctx)).toBe(true);
  });
});

describe('evaluateCondition — defensive', () => {
  it('never throws on a malformed tree', () => {
    expect(evaluateCondition({} as Condition, ctx)).toBe(false);
    expect(evaluateCondition({ field: 'task.title' } as unknown as Condition, ctx)).toBe(false); // no op
    expect(evaluateCondition(null as unknown as Condition, ctx)).toBe(false);
  });
});

describe('evaluateConditions — implicit all_of', () => {
  it('empty list is vacuously true', () => {
    expect(evaluateConditions([], ctx)).toBe(true);
  });
  it('all must hold', () => {
    expect(
      evaluateConditions(
        [
          { field: 'task.custom_data.priority', op: 'eq', value: 'high' },
          { field: 'task.repro_steps', op: 'exists' },
        ],
        ctx,
      ),
    ).toBe(true);
    expect(evaluateConditions([{ field: 'task.repro_steps', op: 'not_exists' }], ctx)).toBe(false);
  });
});
