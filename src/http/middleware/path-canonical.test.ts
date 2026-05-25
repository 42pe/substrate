import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { assertPathUnder } from './path-canonical.js';
import { SubstrateError } from '../../core/errors.js';

describe('assertPathUnder', () => {
  const base = resolve('/tmp/test-base');

  it('allows a path inside the base', () => {
    expect(() => assertPathUnder(`${base}/file.txt`, base)).not.toThrow();
  });

  it('allows a deeply nested path inside the base', () => {
    expect(() => assertPathUnder(`${base}/a/b/c/file.txt`, base)).not.toThrow();
  });

  it('allows the base directory itself', () => {
    expect(() => assertPathUnder(base, base)).not.toThrow();
  });

  it('rejects ..-traversal that escapes', () => {
    expect(() => assertPathUnder(`${base}/../escaped.txt`, base)).toThrow(SubstrateError);
  });

  it('rejects an absolute path outside the base', () => {
    expect(() => assertPathUnder('/etc/passwd', base)).toThrow(SubstrateError);
  });

  it('rejects a sibling that starts with the same prefix string', () => {
    // /tmp/test-base-other should NOT be considered "inside" /tmp/test-base
    expect(() => assertPathUnder(`${base}-other/file.txt`, base)).toThrow(SubstrateError);
  });

  it('attaches the offending path to error details', () => {
    try {
      assertPathUnder('/etc/passwd', base);
      throw new Error('expected throw');
    } catch (e) {
      expect(SubstrateError.is(e)).toBe(true);
      if (SubstrateError.is(e)) {
        expect(e.code).toBe('forbidden');
        expect(e.details).toEqual({ path: '/etc/passwd', base });
      }
    }
  });

  it('handles relative paths by resolving against cwd', () => {
    // Relative paths get resolved; whether they end up under `base` depends on cwd.
    // The function is meant for ALREADY-absolute paths but is defensive: if a
    // caller passes a relative path that resolves outside base, we reject.
    expect(() => assertPathUnder('relative/file.txt', base)).toThrow(SubstrateError);
  });
});
