import { describe, it, expect, vi, afterEach } from 'vitest';
import { extractFlagValue, rejectUnknownFlags } from './args.js';

afterEach(() => vi.restoreAllMocks());

describe('extractFlagValue', () => {
  it('extracts the space form and removes flag + value from residual', () => {
    expect(extractFlagValue(['--template', 'web-delivery'], '--template')).toEqual({
      value: 'web-delivery',
      rest: [],
    });
  });

  it('extracts the equals form', () => {
    expect(extractFlagValue(['--template=web-delivery'], '--template')).toEqual({
      value: 'web-delivery',
      rest: [],
    });
  });

  it('returns undefined value + intact residual when the flag is absent', () => {
    expect(extractFlagValue(['--no-starter-board'], '--template')).toEqual({
      value: undefined,
      rest: ['--no-starter-board'],
    });
  });

  it('leaves other flags in the residual (so rejectUnknownFlags still sees them)', () => {
    expect(extractFlagValue(['--no-starter-board', '--template', 'x'], '--template')).toEqual({
      value: 'x',
      rest: ['--no-starter-board'],
    });
  });

  it('exits with a clear error when the flag has no value', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    expect(() => extractFlagValue(['--template'], '--template')).toThrow('exit');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('treats a following flag-shaped token as a missing value (not the value)', () => {
    vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    expect(() => extractFlagValue(['--template', '--out'], '--template')).toThrow('exit');
  });
});

describe('rejectUnknownFlags (head-compare)', () => {
  it('accepts an allowed flag and the =form of an allowed flag', () => {
    expect(() => rejectUnknownFlags('explain', ['--out=x.html'])).not.toThrow();
    expect(() => rejectUnknownFlags('init', ['--no-starter-board'])).not.toThrow();
    expect(() => rejectUnknownFlags('init', [])).not.toThrow();
  });

  it('rejects an unknown flag', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    expect(() => rejectUnknownFlags('init', ['--bogus'])).toThrow('exit');
    expect(exit).toHaveBeenCalledWith(1);
  });
});
