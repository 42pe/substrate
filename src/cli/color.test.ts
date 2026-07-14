import { describe, it, expect, afterEach, vi } from 'vitest';
import { bold, dim, cyan, yellow, stripAnsi, colorEnabled } from './color.js';

afterEach(() => vi.restoreAllMocks());

describe('color wrappers', () => {
  it('return the string UNCHANGED when disabled', () => {
    expect(bold('x', false)).toBe('x');
    expect(dim('x', false)).toBe('x');
    expect(cyan('x', false)).toBe('x');
    expect(yellow('x', false)).toBe('x');
  });

  it('wrap in an SGR escape + reset when enabled', () => {
    expect(bold('x', true)).toBe('\x1b[1mx\x1b[0m');
    expect(cyan('x', true)).toBe('\x1b[36mx\x1b[0m');
  });

  it('stripAnsi removes exactly what the wrappers add (round-trip)', () => {
    const s = `${bold('a', true)} ${cyan('b', true)} ${yellow('c', true)}`;
    expect(stripAnsi(s)).toBe('a b c');
  });
});

describe('colorEnabled', () => {
  const withStdout = (isTTY: boolean | undefined, noColor: string | undefined): boolean => {
    const origTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
    Object.defineProperty(process.stdout, 'isTTY', { value: isTTY, configurable: true });
    const prev = process.env.NO_COLOR;
    if (noColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = noColor;
    try {
      return colorEnabled();
    } finally {
      if (origTTY) Object.defineProperty(process.stdout, 'isTTY', origTTY);
      else Reflect.deleteProperty(process.stdout, 'isTTY');
      if (prev === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = prev;
    }
  };

  it('is on for a TTY without NO_COLOR', () => {
    expect(withStdout(true, undefined)).toBe(true);
  });

  it('is off when not a TTY (piped/redirected)', () => {
    expect(withStdout(undefined, undefined)).toBe(false);
    expect(withStdout(false, undefined)).toBe(false);
  });

  it('is off on a TTY when NO_COLOR is set', () => {
    expect(withStdout(true, '1')).toBe(false);
  });
});
