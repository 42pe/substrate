import { describe, it, expect } from 'vitest';
import { renderMarkdown } from './markdown.js';

describe('renderMarkdown — sanitizer (security-critical)', () => {
  it('imports + runs under jsdom (the marked → DOMPurify chain is wired)', () => {
    // The Step-1 smoke: if DOMPurify isn't window-bound this throws.
    expect(typeof renderMarkdown('hello')).toBe('string');
  });

  it('strips <script>', () => {
    const out = renderMarkdown('before<script>alert(1)</script>after');
    expect(out).not.toMatch(/<script/i);
    expect(out).toContain('before');
    expect(out).toContain('after');
  });

  it('strips event-handler attributes (onerror)', () => {
    const out = renderMarkdown('<img src=x onerror="alert(1)">');
    expect(out).not.toMatch(/onerror/i);
  });

  it('strips javascript: URLs', () => {
    const out = renderMarkdown('[click](javascript:alert(1))');
    expect(out).not.toMatch(/javascript:/i);
  });

  it('strips data: URLs in links', () => {
    const out = renderMarkdown('[x](data:text/html,<script>alert(1)</script>)');
    expect(out).not.toMatch(/<script/i);
  });

  it('POSITIVE: ordinary formatting survives sanitization', () => {
    const out = renderMarkdown(
      '**bold** and `code` and [link](https://example.com)\n\n- one\n- two',
    );
    expect(out).toMatch(/<strong>bold<\/strong>/);
    expect(out).toMatch(/<code>code<\/code>/);
    expect(out).toMatch(/<a href="https:\/\/example\.com"/);
    expect(out).toMatch(/<ul>/);
    expect(out).toMatch(/<li>one<\/li>/);
  });
});
