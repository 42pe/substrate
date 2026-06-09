import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  logger,
  sanitizeAgentName,
  configureFileSink,
  resetFileSink,
  LOG_MAX_BYTES,
} from './logger.js';

const HEADER_RE = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z (INFO|WARN|ERROR) /;

describe('sanitizeAgentName', () => {
  it('wraps a clean name in brackets', () => {
    expect(sanitizeAgentName('triage-agent')).toBe('[triage-agent]');
  });

  it('strips ASCII control chars', () => {
    expect(sanitizeAgentName('foo\x00bar\x1fbaz')).toBe('[foobarbaz]');
  });

  it('strips DEL (0x7f)', () => {
    expect(sanitizeAgentName('foo\x7fbar')).toBe('[foobar]');
  });

  it('strips newlines (prevents log injection)', () => {
    expect(sanitizeAgentName('legit-agent\nFAKE LOG LINE injected')).toBe(
      '[legit-agentFAKE LOG LINE injected]',
    );
  });

  it('truncates to 100 chars', () => {
    const long = 'a'.repeat(200);
    const result = sanitizeAgentName(long);
    // 100 'a's + the 2 brackets
    expect(result.length).toBe(102);
    expect(result.startsWith('[')).toBe(true);
    expect(result.endsWith(']')).toBe(true);
  });

  it('preserves printable ASCII', () => {
    expect(sanitizeAgentName('agent_v1.2 (test) ! @ # $')).toBe('[agent_v1.2 (test) ! @ # $]');
  });

  it('handles empty input', () => {
    expect(sanitizeAgentName('')).toBe('[]');
  });
});

describe('logger', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('logs an info line via console.log', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    logger.info('hello');
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]?.[0]).toMatch(/INFO hello$/);
  });

  it('includes a JSON-encoded context when provided', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    logger.info('write happened', { task_id: 'abc' });
    expect(spy.mock.calls[0]?.[0]).toContain('"task_id":"abc"');
  });

  it('sanitizes agent_name in context', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    logger.info('write happened', { agent_name: 'evil\nINJECTED' });
    const out = spy.mock.calls[0]?.[0] as string;
    expect(out).toContain('[evilINJECTED]');
    expect(out).not.toContain('\\nINJECTED'); // verify not just escaped — actually stripped
  });

  it('warn and error route to their respective console methods', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    logger.warn('w');
    logger.error('e');
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(errSpy).toHaveBeenCalledOnce();
  });
});

describe('logger file sink', () => {
  let dir: string;
  let logFile: string;

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    dir = mkdtempSync(join(tmpdir(), 'substrate-log-'));
    logFile = join(dir, 'logs', 'substrate.log');
  });
  afterEach(() => {
    resetFileSink(); // MANDATED: no test leaves sinkPath set (CONCERN-1)
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes nothing when the sink is unconfigured', () => {
    resetFileSink();
    logger.error('boom', { error: 'x' });
    expect(existsSync(logFile)).toBe(false);
  });

  it('appends error/warn but NOT info once configured', () => {
    configureFileSink(logFile);
    logger.error('an error');
    logger.warn('a warning');
    logger.info('chatter');
    const contents = readFileSync(logFile, 'utf-8');
    expect(contents).toContain('ERROR an error');
    expect(contents).toContain('WARN a warning');
    expect(contents).not.toContain('chatter'); // info never hits the file
  });

  it('captures the stack in the file but excludes `err` from every serialized context', () => {
    configureFileSink(logFile);
    const errSpy = vi.spyOn(console, 'error');
    const e = new Error('kaboom');
    logger.error('failed', { error: e.message, err: e, agent_name: 'bad\nname' });

    // Console line: err deleted, agent_name sanitized, NO stack.
    const consoleLine = errSpy.mock.calls.at(-1)?.[0] as string;
    expect(consoleLine).toContain('"error":"kaboom"');
    expect(consoleLine).toContain('[badname]');
    expect(consoleLine).not.toContain('"err"');
    expect(consoleLine).not.toContain('at '); // no stack frame on the console line

    // File: header JSON excludes `err`, but a rendered stack block is present.
    const contents = readFileSync(logFile, 'utf-8');
    const headerLine = contents.split('\n')[0]!;
    expect(headerLine).toContain('"error":"kaboom"');
    expect(headerLine).toContain('[badname]');
    expect(headerLine).not.toContain('"err"');
    expect(contents).toContain('Error: kaboom'); // stack block present
    expect(contents).toMatch(/\n {4,}at /); // stack frames indented (won't match HEADER_RE)
  });

  it('writes one contiguous event (header + indented stack + trailing newline)', () => {
    configureFileSink(logFile);
    logger.error('one', { err: new Error('boom') });
    const contents = readFileSync(logFile, 'utf-8');
    // Exactly one header line; the rest is the indented stack block.
    const headerLines = contents.split('\n').filter((l) => HEADER_RE.test(l));
    expect(headerLines.length).toBe(1);
    expect(contents.endsWith('\n')).toBe(true);
    expect(contents).toMatch(/^[^\n]+\n {4}Error: boom/);
  });

  it('never crashes the caller when the sink path is un-writable', () => {
    // A regular file where a directory is expected → mkdir/append throw ENOTDIR.
    const blocker = join(dir, 'blocker');
    writeFileSync(blocker, 'i am a file');
    configureFileSink(join(blocker, 'logs', 'substrate.log'));
    const errSpy = vi.spyOn(console, 'error');
    expect(() => logger.error('still works')).not.toThrow();
    expect(errSpy).toHaveBeenCalled(); // console line still emitted
  });

  it('rotates to substrate.log.1 when an append would exceed the cap', () => {
    configureFileSink(logFile);
    const big = 'x'.repeat(3 * 1024 * 1024); // ~3 MiB; two of these exceed 5 MiB
    logger.error(big);
    logger.error(big);
    expect(existsSync(`${logFile}.1`)).toBe(true);
    expect(statSync(logFile).size).toBeLessThan(LOG_MAX_BYTES);
    expect(statSync(`${logFile}.1`).size).toBeLessThan(LOG_MAX_BYTES);
  });
});
