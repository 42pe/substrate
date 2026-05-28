import { describe, it, expect } from 'vitest';
import {
  encodeCursor,
  decodeCursor,
  paginationShape,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from './pagination.js';
import { SubstrateError } from './errors.js';

describe('cursor encode/decode', () => {
  it('round-trips a string-id tuple (tasks/comments)', () => {
    const tuple = { u: '2026-05-28T00:00:00.000Z', i: 'task-abc' };
    const decoded = decodeCursor<string>(encodeCursor(tuple));
    expect(decoded).toEqual(tuple);
  });

  it('round-trips a number-id tuple (task_events)', () => {
    const tuple = { u: '2026-05-28T00:00:00.000Z', i: 42 };
    const decoded = decodeCursor<number>(encodeCursor(tuple));
    expect(decoded).toEqual(tuple);
  });

  it('produces an opaque base64url string (no padding, url-safe)', () => {
    const cursor = encodeCursor({ u: '2026-05-28T00:00:00.000Z', i: 'x' });
    expect(cursor).not.toMatch(/[+/=]/);
  });

  it('throws schema_violation on non-base64 garbage', () => {
    try {
      decodeCursor('!!!not base64!!!');
      throw new Error('expected throw');
    } catch (e) {
      expect(SubstrateError.is(e)).toBe(true);
      if (SubstrateError.is(e)) expect(e.code).toBe('schema_violation');
    }
  });

  it('throws schema_violation on valid base64 of wrong shape', () => {
    const bad = Buffer.from(JSON.stringify({ nope: 1 }), 'utf-8').toString('base64url');
    expect(() => decodeCursor(bad)).toThrow(SubstrateError);
  });
});

describe('paginationShape', () => {
  it('defaults page_size to DEFAULT_PAGE_SIZE when omitted', () => {
    const parsed = paginationShape.parse({});
    expect(parsed.page_size).toBe(DEFAULT_PAGE_SIZE);
  });

  it('accepts an explicit page_size within bounds', () => {
    expect(paginationShape.parse({ page_size: 10 }).page_size).toBe(10);
    expect(paginationShape.parse({ page_size: MAX_PAGE_SIZE }).page_size).toBe(MAX_PAGE_SIZE);
  });

  it('rejects page_size over the ceiling', () => {
    expect(() => paginationShape.parse({ page_size: MAX_PAGE_SIZE + 1 })).toThrow();
  });

  it('rejects page_size below 1', () => {
    expect(() => paginationShape.parse({ page_size: 0 })).toThrow();
  });

  it('carries an optional cursor through', () => {
    const parsed = paginationShape.parse({ cursor: 'abc' });
    expect(parsed.cursor).toBe('abc');
  });
});
