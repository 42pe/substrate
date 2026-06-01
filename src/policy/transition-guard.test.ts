import { describe, it, expect } from 'vitest';
import { parseGuardDefinition, guardEngages, guardPasses } from './transition-guard.js';
import type { EvalContext } from './types.js';

describe('parseGuardDefinition', () => {
  it('parses a well-formed definition', () => {
    const def = parseGuardDefinition({
      from_group: 'todo',
      to_group: 'in_progress',
      require: [{ field: 'task.custom_data.repro_steps', op: 'exists' }],
      on_failure_message: 'Set repro_steps first.',
    });
    expect(def).toEqual({
      fromGroup: 'todo',
      toGroup: 'in_progress',
      require: [{ field: 'task.custom_data.repro_steps', op: 'exists' }],
      onFailureMessage: 'Set repro_steps first.',
    });
  });

  it('returns null when from/to are not strings', () => {
    expect(parseGuardDefinition({ to_group: 'x' })).toBeNull();
    expect(parseGuardDefinition({ from_group: 1, to_group: 'x' })).toBeNull();
    expect(parseGuardDefinition({})).toBeNull();
  });

  it('non-array require → empty (guard passes trivially)', () => {
    const def = parseGuardDefinition({ from_group: 'a', to_group: 'b', require: 'nope' });
    expect(def?.require).toEqual([]);
  });

  it('absent require → empty', () => {
    const def = parseGuardDefinition({ from_group: 'a', to_group: 'b' });
    expect(def?.require).toEqual([]);
    expect(def?.onFailureMessage).toBeNull();
  });

  it('non-string on_failure_message → null', () => {
    const def = parseGuardDefinition({ from_group: 'a', to_group: 'b', on_failure_message: 42 });
    expect(def?.onFailureMessage).toBeNull();
  });
});

describe('guardEngages', () => {
  const def = { fromGroup: 'todo', toGroup: 'in_progress', require: [], onFailureMessage: null };
  it('matches an exact transition', () => {
    expect(guardEngages(def, 'todo', 'in_progress')).toBe(true);
  });
  it('does not engage on a non-matching transition', () => {
    expect(guardEngages(def, 'todo', 'done')).toBe(false);
    expect(guardEngages(def, 'backlog', 'in_progress')).toBe(false);
  });
  it("'*' wildcard matches any from and/or to", () => {
    expect(guardEngages({ ...def, fromGroup: '*' }, 'anything', 'in_progress')).toBe(true);
    expect(guardEngages({ ...def, toGroup: '*' }, 'todo', 'anywhere')).toBe(true);
    expect(
      guardEngages({ fromGroup: '*', toGroup: '*', require: [], onFailureMessage: null }, 'a', 'b'),
    ).toBe(true);
  });
});

describe('guardPasses', () => {
  const candidate: EvalContext = { task: { custom_data: { repro_steps: 'x' } } };
  it('passes when require holds', () => {
    expect(
      guardPasses(
        {
          fromGroup: 'a',
          toGroup: 'b',
          require: [{ field: 'task.custom_data.repro_steps', op: 'exists' }],
          onFailureMessage: null,
        },
        candidate,
      ),
    ).toBe(true);
  });
  it('fails when require does not hold', () => {
    expect(
      guardPasses(
        {
          fromGroup: 'a',
          toGroup: 'b',
          require: [{ field: 'task.custom_data.missing', op: 'exists' }],
          onFailureMessage: null,
        },
        candidate,
      ),
    ).toBe(false);
  });
  it('empty require passes trivially', () => {
    expect(
      guardPasses({ fromGroup: 'a', toGroup: 'b', require: [], onFailureMessage: null }, candidate),
    ).toBe(true);
  });
});
