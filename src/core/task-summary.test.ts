import { describe, it, expect } from 'vitest';
import {
  toTaskSummary,
  excerpt,
  DESCRIPTION_EXCERPT_MAX,
  CUSTOM_VALUE_STRING_MAX,
} from './task-summary.js';
import type { Task } from './types.js';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    board_id: 'b1',
    group_id: 'g1',
    parent_id: null,
    origin_task_id: null,
    title: 'A task',
    description: '',
    custom_data: {},
    version: 1,
    created_by_agent: 'tester',
    created_at: '2026-05-09T00:00:00.000Z',
    updated_at: '2026-05-09T00:00:00.000Z',
    archived_at: null,
    ...overrides,
  };
}

describe('excerpt', () => {
  it('returns empty + not-truncated for an empty string', () => {
    expect(excerpt('', 10)).toEqual({ text: '', truncated: false });
  });

  it('returns the input unchanged when within the cap', () => {
    expect(excerpt('short', 10)).toEqual({ text: 'short', truncated: false });
  });

  it('truncates with an ellipsis when over the cap', () => {
    const r = excerpt('abcdefghij klmnop', 10);
    expect(r.truncated).toBe(true);
    expect(r.text.endsWith('…')).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(11); // ≤10 graphemes + …
  });

  it('backs off to the last word boundary when it falls late enough', () => {
    // 12-grapheme cap lands mid-"world"; backs off to the space after "hello".
    const r = excerpt('hello world foo', 12);
    expect(r.text).toBe('hello world…');
  });

  it('does NOT split a surrogate pair (emoji safe)', () => {
    // 5 red-circle emoji; cap of 3 graphemes must keep 3 WHOLE emoji + ….
    const r = excerpt('🔴🔴🔴🔴🔴', 3);
    expect(r.truncated).toBe(true);
    expect(r.text).not.toContain('�'); // no replacement char
    expect(r.text).toBe('🔴🔴🔴…');
    expect([...r.text].length).toBe(4); // 3 emoji + ellipsis, by code point
  });

  it('counts length in graphemes, so a short multibyte string is not truncated', () => {
    const r = excerpt('🔴 done', 10);
    expect(r.truncated).toBe(false);
    expect(r.text).toBe('🔴 done');
  });
});

describe('toTaskSummary', () => {
  it('drops description, keeping a bounded excerpt + truncated flag', () => {
    const long = 'x'.repeat(DESCRIPTION_EXCERPT_MAX + 50);
    const s = toTaskSummary(makeTask({ description: long }));
    expect(s).not.toHaveProperty('description');
    expect(s.description_truncated).toBe(true);
    expect(s.description_excerpt.endsWith('…')).toBe(true);
    expect(s.description_excerpt.length).toBeLessThan(long.length);
  });

  it('keeps scalar custom_data values (boolean, number, null, short string)', () => {
    const s = toTaskSummary(
      makeTask({
        custom_data: {
          tests_passing: true,
          priority: 'high',
          count: 3,
          cleared: null,
        },
      }),
    );
    expect(s.custom_data).toEqual({
      tests_passing: true,
      priority: 'high',
      count: 3,
      cleared: null,
    });
    expect(s.custom_data_omitted).toEqual([]);
  });

  it('omits bulky values (long string, array, object) and lists their keys', () => {
    const s = toTaskSummary(
      makeTask({
        custom_data: {
          priority: 'high', // kept
          acceptance_criteria: 'y'.repeat(CUSTOM_VALUE_STRING_MAX + 1), // long string → omitted
          tags: ['a', 'b'], // array → omitted
          meta: { nested: 1 }, // object → omitted
        },
      }),
    );
    expect(s.custom_data).toEqual({ priority: 'high' });
    expect(s.custom_data_omitted.sort()).toEqual(['acceptance_criteria', 'meta', 'tags']);
  });

  it('keeps a string exactly at the length cap', () => {
    const atCap = 'z'.repeat(CUSTOM_VALUE_STRING_MAX);
    const s = toTaskSummary(makeTask({ custom_data: { note: atCap } }));
    expect(s.custom_data['note']).toBe(atCap);
    expect(s.custom_data_omitted).toEqual([]);
  });

  it('carries the small verbatim fields through', () => {
    const s = toTaskSummary(
      makeTask({ id: 'x', title: 'T', group_id: 'g2', version: 7, archived_at: null }),
    );
    expect(s).toMatchObject({ id: 'x', title: 'T', group_id: 'g2', version: 7 });
  });
});
