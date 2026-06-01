import { describe, it, expect } from 'vitest';
import { parseResponsibilityDefinition, responsibilityMatches } from './agent-responsibility.js';
import type { EvalContext } from './types.js';

describe('parseResponsibilityDefinition', () => {
  it('parses a well-formed definition', () => {
    const def = parseResponsibilityDefinition({
      when: [{ field: 'task.title', op: 'matches_any_keyword', values: ['auth'] }],
      message: 'Consider linking auth tasks.',
    });
    expect(def).toEqual({
      when: [{ field: 'task.title', op: 'matches_any_keyword', values: ['auth'] }],
      message: 'Consider linking auth tasks.',
    });
  });

  it('returns null when message is missing or non-string (does not fire)', () => {
    expect(parseResponsibilityDefinition({ when: [] })).toBeNull();
    expect(parseResponsibilityDefinition({ message: 42 })).toBeNull();
    expect(parseResponsibilityDefinition({ message: '' })).toBeNull();
  });

  it('absent / non-array when → empty (always matches)', () => {
    expect(parseResponsibilityDefinition({ message: 'm' })?.when).toEqual([]);
    expect(parseResponsibilityDefinition({ message: 'm', when: 'nope' })?.when).toEqual([]);
  });
});

describe('responsibilityMatches', () => {
  const state: EvalContext = { task: { title: 'Fix the login bug' } };

  it('matches when conditions hold', () => {
    expect(
      responsibilityMatches(
        {
          when: [{ field: 'task.title', op: 'matches_any_keyword', values: ['login'] }],
          message: 'm',
        },
        state,
      ),
    ).toBe(true);
  });

  it('does not match when conditions fail', () => {
    expect(
      responsibilityMatches(
        {
          when: [{ field: 'task.title', op: 'matches_any_keyword', values: ['payment'] }],
          message: 'm',
        },
        state,
      ),
    ).toBe(false);
  });

  it('empty when always matches', () => {
    expect(responsibilityMatches({ when: [], message: 'm' }, state)).toBe(true);
  });
});
