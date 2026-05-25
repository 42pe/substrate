import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logger, sanitizeAgentName } from './logger.js';

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
