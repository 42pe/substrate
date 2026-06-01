import { describe, it, expect } from 'vitest';
import { applyOperator } from './operators.js';
import type { LeafOperator } from './types.js';

function ok(
  fieldValue: unknown,
  op: LeafOperator,
  extra: { value?: unknown; values?: unknown[] } = {},
) {
  return applyOperator(fieldValue, { field: 'x', op, ...extra });
}

describe('operators — existence', () => {
  it('exists / not_exists', () => {
    expect(ok('v', 'exists')).toBe(true);
    expect(ok(0, 'exists')).toBe(true);
    expect(ok(false, 'exists')).toBe(true);
    expect(ok(null, 'exists')).toBe(false);
    expect(ok(undefined, 'exists')).toBe(false);
    expect(ok(undefined, 'not_exists')).toBe(true);
    expect(ok('v', 'not_exists')).toBe(false);
  });

  it('is_empty / not_empty cover null, undefined, "", [], {}', () => {
    for (const empty of [null, undefined, '', [], {}]) {
      expect(ok(empty, 'is_empty')).toBe(true);
      expect(ok(empty, 'not_empty')).toBe(false);
    }
    for (const full of ['x', [1], { a: 1 }, 0, false]) {
      expect(ok(full, 'is_empty')).toBe(false);
      expect(ok(full, 'not_empty')).toBe(true);
    }
  });
});

describe('operators — equality & sets', () => {
  it('eq / neq with scalars and structural values', () => {
    expect(ok('a', 'eq', { value: 'a' })).toBe(true);
    expect(ok('a', 'neq', { value: 'b' })).toBe(true);
    expect(ok(['a', 'b'], 'eq', { value: ['a', 'b'] })).toBe(true);
    expect(ok(['a', 'b'], 'eq', { value: ['b', 'a'] })).toBe(false);
  });

  it('in / not_in', () => {
    expect(ok('b', 'in', { values: ['a', 'b'] })).toBe(true);
    expect(ok('z', 'in', { values: ['a', 'b'] })).toBe(false);
    expect(ok('z', 'not_in', { values: ['a', 'b'] })).toBe(true);
    expect(ok('z', 'in', {})).toBe(false); // missing values → no match
  });
});

describe('operators — numeric (no-match on non-numeric)', () => {
  it('gt/gte/lt/lte', () => {
    expect(ok(5, 'gt', { value: 3 })).toBe(true);
    expect(ok(3, 'gt', { value: 3 })).toBe(false);
    expect(ok(3, 'gte', { value: 3 })).toBe(true);
    expect(ok(2, 'lt', { value: 3 })).toBe(true);
    expect(ok(3, 'lte', { value: 3 })).toBe(true);
  });
  it('non-numeric operands never match, never throw', () => {
    expect(ok('five', 'gt', { value: 3 })).toBe(false);
    expect(ok(5, 'gt', { value: 'three' })).toBe(false);
    expect(ok(Infinity, 'gt', { value: 3 })).toBe(false); // non-finite → NaN → no match
    expect(ok(null, 'lte', { value: 3 })).toBe(false);
  });
});

describe('operators — string', () => {
  it('contains / not_contains', () => {
    expect(ok('hello world', 'contains', { value: 'world' })).toBe(true);
    expect(ok('hello', 'contains', { value: 'z' })).toBe(false);
    expect(ok('hello', 'not_contains', { value: 'z' })).toBe(true);
    // non-string field "does not contain" → vacuously true
    expect(ok(123, 'not_contains', { value: 'z' })).toBe(true);
  });
  it('starts_with / ends_with', () => {
    expect(ok('abcdef', 'starts_with', { value: 'abc' })).toBe(true);
    expect(ok('abcdef', 'ends_with', { value: 'def' })).toBe(true);
    expect(ok('abcdef', 'starts_with', { value: 'xyz' })).toBe(false);
  });
  it('matches_regex compiles and matches', () => {
    expect(ok('SUB-123', 'matches_regex', { value: '^SUB-\\d+$' })).toBe(true);
    expect(ok('nope', 'matches_regex', { value: '^SUB-\\d+$' })).toBe(false);
  });
  it('matches_regex degrades safely: invalid, oversized, non-string → false (never throws)', () => {
    expect(ok('x', 'matches_regex', { value: '(' })).toBe(false); // invalid
    expect(ok('x', 'matches_regex', { value: 'a'.repeat(1001) })).toBe(false); // oversized
    expect(ok('x', 'matches_regex', { value: 42 })).toBe(false); // non-string pattern
    expect(ok(42, 'matches_regex', { value: '\\d+' })).toBe(true); // numeric field coerced
  });
  it('matches_any_keyword is case-insensitive substring over values', () => {
    expect(ok('Fix the LOGIN flow', 'matches_any_keyword', { values: ['login', 'auth'] })).toBe(
      true,
    );
    expect(ok('unrelated', 'matches_any_keyword', { values: ['login', 'auth'] })).toBe(false);
    expect(ok('x', 'matches_any_keyword', {})).toBe(false); // no values
  });
});

describe('operators — array', () => {
  it('has_any / has_all', () => {
    expect(ok(['a', 'b'], 'has_any', { values: ['b', 'c'] })).toBe(true);
    expect(ok(['a', 'b'], 'has_any', { values: ['x', 'y'] })).toBe(false);
    expect(ok(['a', 'b', 'c'], 'has_all', { values: ['a', 'b'] })).toBe(true);
    expect(ok(['a'], 'has_all', { values: ['a', 'b'] })).toBe(false);
  });
  it('non-array field never matches', () => {
    expect(ok('a', 'has_any', { values: ['a'] })).toBe(false);
    expect(ok(null, 'has_all', { values: ['a'] })).toBe(false);
  });
});
