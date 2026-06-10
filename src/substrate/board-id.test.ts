import { describe, it, expect } from 'vitest';
import { isSafeBoardId } from './board-id.js';

describe('isSafeBoardId', () => {
  it('accepts a plain single-component id', () => {
    expect(isSafeBoardId('delivery')).toBe(true);
    expect(isSafeBoardId('my-board_2')).toBe(true);
  });

  it('rejects empty, traversal, and separators', () => {
    expect(isSafeBoardId('')).toBe(false);
    expect(isSafeBoardId('..')).toBe(false);
    expect(isSafeBoardId('../x')).toBe(false);
    expect(isSafeBoardId('a/b')).toBe(false);
    expect(isSafeBoardId('a\\b')).toBe(false);
    expect(isSafeBoardId('x/..')).toBe(false);
  });
});
