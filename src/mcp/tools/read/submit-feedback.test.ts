import { describe, it, expect } from 'vitest';
import { submitFeedbackHandler, submitFeedbackSchema, REPO } from './submit-feedback.js';
import { BINARY_VERSION } from '../../../core/version.js';

describe('submitFeedbackHandler', () => {
  it('returns a feedback_url result targeting the upstream repo', () => {
    const r = submitFeedbackHandler({
      title: 'Tool schema is confusing',
      body: 'The x field is unclear.',
    });
    expect(r.result).toBe('feedback_url');
    expect(r.repo).toBe('42pe/substrate');
    expect(REPO).toBe('42pe/substrate');
    expect(r.issue_title).toBe('Substrate Feedback: Tool schema is confusing');
    expect(r.url.startsWith('https://github.com/42pe/substrate/issues/new?')).toBe(true);
    expect(r.url).toContain('labels=feedback');
  });

  it('prefixes the issue title and round-trips it through the URL', () => {
    const r = submitFeedbackHandler({ title: 'a bug', body: 'details' });
    const parsed = new URL(r.url);
    expect(parsed.searchParams.get('title')).toBe('Substrate Feedback: a bug');
  });

  it('encodes special characters in title and body so they round-trip', () => {
    const title = 'A & B #1';
    const body = 'line one\nline two & more #hash = value';
    const r = submitFeedbackHandler({ title, body });
    const parsed = new URL(r.url);
    // Title round-trips with the prefix applied.
    expect(parsed.searchParams.get('title')).toBe('Substrate Feedback: ' + title);
    // Body round-trips, including the appended footer.
    const decodedBody = parsed.searchParams.get('body');
    expect(decodedBody).not.toBeNull();
    expect(decodedBody).toContain(body);
  });

  it('version-stamps the body footer from BINARY_VERSION (no hardcoded literal)', () => {
    const r = submitFeedbackHandler({ title: 't', body: 'b' });
    const decodedBody = new URL(r.url).searchParams.get('body')!;
    expect(decodedBody).toContain(`Substrate v${BINARY_VERSION}`);
    expect(decodedBody.endsWith(`Filed via Substrate v${BINARY_VERSION}`)).toBe(true);
  });

  it('includes an Agent line only when agent_name is supplied', () => {
    const withAgent = submitFeedbackHandler({ title: 't', body: 'b', agent_name: 'claude-code' });
    const withAgentBody = new URL(withAgent.url).searchParams.get('body')!;
    expect(withAgentBody).toContain('Agent: claude-code');

    const withoutAgent = submitFeedbackHandler({ title: 't', body: 'b' });
    const withoutAgentBody = new URL(withoutAgent.url).searchParams.get('body')!;
    expect(withoutAgentBody).not.toContain('Agent:');
  });

  it('carries no `ok` field (so the wrapper reports isError: false)', () => {
    const r = submitFeedbackHandler({ title: 't', body: 'b' });
    expect('ok' in r).toBe(false);
  });

  it('is deterministic — same inputs produce the same URL', () => {
    const input = { title: 't', body: 'b', agent_name: 'a' };
    expect(submitFeedbackHandler(input).url).toBe(submitFeedbackHandler(input).url);
  });
});

describe('submitFeedbackSchema', () => {
  it('accepts valid input', () => {
    expect(submitFeedbackSchema.safeParse({ title: 't', body: 'b' }).success).toBe(true);
    expect(submitFeedbackSchema.safeParse({ title: 't', body: 'b', agent_name: 'a' }).success).toBe(
      true,
    );
  });

  it('rejects a title over 120 chars', () => {
    expect(submitFeedbackSchema.safeParse({ title: 'x'.repeat(121), body: 'b' }).success).toBe(
      false,
    );
  });

  it('rejects a body over 4096 chars', () => {
    expect(submitFeedbackSchema.safeParse({ title: 't', body: 'x'.repeat(4097) }).success).toBe(
      false,
    );
  });

  it('rejects an empty title or body', () => {
    expect(submitFeedbackSchema.safeParse({ title: '', body: 'b' }).success).toBe(false);
    expect(submitFeedbackSchema.safeParse({ title: 't', body: '' }).success).toBe(false);
  });
});
