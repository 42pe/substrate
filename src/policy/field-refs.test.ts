import { describe, it, expect } from 'vitest';
import { taskFieldName, collectLeaves } from './field-refs.js';
import type { Condition } from './types.js';

describe('taskFieldName', () => {
  it('resolves the explicit custom_data path to the field name', () => {
    expect(taskFieldName('task.custom_data.plan_approved')).toBe('plan_approved');
  });

  it('resolves the shorthand task.<field> path to the field name', () => {
    expect(taskFieldName('task.plan_approved')).toBe('plan_approved');
  });

  it('reports the first segment for a deeper custom_data path', () => {
    expect(taskFieldName('task.custom_data.obj.nested')).toBe('obj');
  });

  it('returns null for a non-task path', () => {
    expect(taskFieldName('comment.custom_data.x')).toBeNull();
    expect(taskFieldName('board.name')).toBeNull();
  });
});

describe('collectLeaves', () => {
  it('flattens leaves out of a nested all_of / any_of / none_of tree', () => {
    const tree: Condition[] = [
      { field: 'task.custom_data.a', op: 'exists' },
      {
        any_of: [
          { field: 'task.custom_data.b', op: 'eq', value: true },
          { none_of: [{ field: 'task.custom_data.c', op: 'exists' }] },
        ],
      },
    ] as unknown as Condition[];
    const leaves = collectLeaves(tree);
    const fields = leaves.map((l) => l.field);
    expect(fields).toEqual(['task.custom_data.a', 'task.custom_data.b', 'task.custom_data.c']);
  });

  it('returns an empty array for a non-array input', () => {
    expect(collectLeaves(undefined as unknown as Condition[])).toEqual([]);
  });
});
