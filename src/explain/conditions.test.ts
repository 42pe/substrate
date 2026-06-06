import { describe, it, expect } from 'vitest';
import { describeConditions } from './conditions.js';

describe('describeConditions', () => {
  it('renders leaf operators as phrases', () => {
    expect(describeConditions([{ field: 'task.tests_passing', op: 'eq', value: true }])).toBe(
      'tests_passing = true',
    );
    expect(
      describeConditions([{ field: 'task.priority', op: 'in', values: ['high', 'urgent'] }]),
    ).toBe('priority in {high, urgent}');
    expect(describeConditions([{ field: 'task.count', op: 'gte', value: 3 }])).toBe('count ≥ 3');
    expect(describeConditions([{ field: 'task.owner', op: 'exists' }])).toBe('owner is set');
  });

  it('joins multiple conditions with "and" (implicit all_of)', () => {
    expect(
      describeConditions([
        { field: 'task.a', op: 'eq', value: 1 },
        { field: 'task.b', op: 'eq', value: 2 },
      ]),
    ).toBe('a = 1 and b = 2');
  });

  it('renders compound combinators', () => {
    expect(
      describeConditions([
        {
          any_of: [
            { field: 'task.a', op: 'exists' },
            { field: 'task.b', op: 'exists' },
          ],
        },
      ]),
    ).toBe('any of: (a is set; b is set)');
  });

  it('shows group_id as a literal field (no task. prefix, no custom_data note)', () => {
    expect(describeConditions([{ field: 'task.group_id', op: 'eq', value: 'done' }])).toBe(
      'group_id = done',
    );
  });

  it('degrades a malformed condition to (unparseable condition), never throws', () => {
    expect(describeConditions([{ nonsense: true }])).toBe('(unparseable condition)');
    expect(describeConditions([{ field: 'task.x', op: 'not_a_real_op' }])).toBe(
      '(unparseable condition)',
    );
    expect(describeConditions('not an array')).toBe('(always)');
    expect(describeConditions([])).toBe('(always)');
  });
});
