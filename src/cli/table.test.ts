import { describe, it, expect } from 'vitest';
import { visibleWidth, truncate, padEnd, flexWidth, ELLIPSIS } from './table.js';
import { cyan } from './color.js';

describe('visibleWidth', () => {
  it('counts printable chars, excluding ANSI escapes', () => {
    expect(visibleWidth('hello')).toBe(5);
    expect(visibleWidth(cyan('hello', true))).toBe(5);
  });
});

describe('truncate', () => {
  it('passes short strings through untouched', () => {
    expect(truncate('hi', 5)).toBe('hi');
    expect(truncate('hello', 5)).toBe('hello');
  });

  it('clamps with a trailing ellipsis when too long', () => {
    expect(truncate('hello world', 5)).toBe(`hell${ELLIPSIS}`);
    expect(truncate('hello world', 5)).toHaveLength(5);
  });

  it('handles the degenerate widths', () => {
    expect(truncate('hello', 0)).toBe('');
    expect(truncate('hello', 1)).toBe(ELLIPSIS);
  });
});

describe('padEnd', () => {
  it('pads to the target visible width', () => {
    expect(padEnd('ab', 5)).toBe('ab   ');
  });

  it('measures visible width, so trailing color escapes do not inflate the pad', () => {
    const padded = padEnd(cyan('ab', true), 5);
    // stripped visible length is 5 (2 chars + 3 spaces), escapes are extra.
    expect(padded.endsWith('   ')).toBe(true);
  });

  it('leaves already-wide strings alone', () => {
    expect(padEnd('abcdef', 3)).toBe('abcdef');
  });
});

describe('flexWidth', () => {
  it('returns the natural width when it fits the budget', () => {
    expect(flexWidth(10, 40, 80, 5)).toBe(10);
  });

  it('shrinks toward the budget when the natural width overflows', () => {
    // budget = 80 - 65 = 15; natural 40 shrinks to 15 (> floor 5).
    expect(flexWidth(40, 65, 80, 5)).toBe(15);
  });

  it('never shrinks below the floor (row is allowed to overflow instead)', () => {
    // budget = 80 - 78 = 2, but floor is 5.
    expect(flexWidth(40, 78, 80, 5)).toBe(5);
  });

  it('never expands beyond the natural width', () => {
    expect(flexWidth(3, 0, 80, 5)).toBe(3);
  });

  it('does not pad short content out to the floor even when the budget is negative', () => {
    // natural 15 < floor 24, and a huge fixed column makes the budget negative:
    // the flex column stays at its natural 15, it does not grow to the floor.
    expect(flexWidth(15, 200, 80, 24)).toBe(15);
  });
});
