import { describe, it, expect } from 'vitest';
import { validatePolicyDefinition } from './definition-schema.js';
import { SubstrateError } from '../core/errors.js';

const raise = SubstrateError.schemaViolation;

function code(fn: () => void): string | undefined {
  try {
    fn();
  } catch (e) {
    return SubstrateError.is(e) ? e.code : 'non-substrate-error';
  }
  return undefined;
}

describe('validatePolicyDefinition — transition_guard', () => {
  it('accepts a minimal guard', () => {
    expect(() =>
      validatePolicyDefinition('transition_guard', { from_group: 'a', to_group: 'b' }, raise),
    ).not.toThrow();
  });

  it('accepts wildcards, require conditions, and on_failure_message', () => {
    expect(() =>
      validatePolicyDefinition(
        'transition_guard',
        {
          from_group: '*',
          to_group: 'done',
          require: [
            { field: 'task.tests_passing', op: 'eq', value: true },
            { all_of: [{ field: 'task.x', op: 'exists' }] },
          ],
          on_failure_message: 'set tests_passing',
        },
        raise,
      ),
    ).not.toThrow();
  });

  it('rejects a missing to_group', () => {
    expect(
      code(() => validatePolicyDefinition('transition_guard', { from_group: 'a' }, raise)),
    ).toBe('schema_violation');
  });

  it('rejects a non-string from_group', () => {
    expect(
      code(() =>
        validatePolicyDefinition('transition_guard', { from_group: 1, to_group: 'b' }, raise),
      ),
    ).toBe('schema_violation');
  });

  it('rejects an unknown operator in a leaf condition', () => {
    expect(
      code(() =>
        validatePolicyDefinition(
          'transition_guard',
          { from_group: 'a', to_group: 'b', require: [{ field: 'task.x', op: 'equals' }] },
          raise,
        ),
      ),
    ).toBe('schema_violation');
  });

  it('rejects an unknown top-level key (strict)', () => {
    expect(
      code(() =>
        validatePolicyDefinition(
          'transition_guard',
          { from_group: 'a', to_group: 'b', oops: 1 },
          raise,
        ),
      ),
    ).toBe('schema_violation');
  });
});

describe('validatePolicyDefinition — agent_responsibility', () => {
  it('accepts a message-only definition (empty when ⇒ always)', () => {
    expect(() =>
      validatePolicyDefinition('agent_responsibility', { message: 'do the thing' }, raise),
    ).not.toThrow();
  });

  it('accepts when conditions', () => {
    expect(() =>
      validatePolicyDefinition(
        'agent_responsibility',
        { when: [{ field: 'task.type', op: 'eq', value: 'bug' }], message: 'add a repro' },
        raise,
      ),
    ).not.toThrow();
  });

  it('rejects a missing message', () => {
    expect(code(() => validatePolicyDefinition('agent_responsibility', { when: [] }, raise))).toBe(
      'schema_violation',
    );
  });

  it('rejects an empty message', () => {
    expect(
      code(() => validatePolicyDefinition('agent_responsibility', { message: '' }, raise)),
    ).toBe('schema_violation');
  });

  it('honors the raise factory error code (load path → internal_error)', () => {
    expect(
      code(() =>
        validatePolicyDefinition('agent_responsibility', {}, SubstrateError.internalError),
      ),
    ).toBe('internal_error');
  });
});
