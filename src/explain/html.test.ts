import { describe, it, expect } from 'vitest';
import { escHtml, escXml, slugify } from './html.js';

describe('escaping', () => {
  it('escHtml escapes & < > " \'', () => {
    expect(escHtml(`<script>"x"&'y'`)).toBe('&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;');
  });

  it('escXml escapes & < > " for SVG text/title', () => {
    expect(escXml(`a<b>&"c`)).toBe('a&lt;b&gt;&amp;&quot;c');
  });

  it('slugify reduces to [A-Za-z0-9_-] only (no attribute breakout)', () => {
    // A crafted group id that tries to break out of id="..." / class="..."
    const evil = 'x" onload="alert(1)"><script>';
    const slug = slugify(evil);
    expect(slug).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(slug).not.toContain('"');
    expect(slug).not.toContain('<');
    expect(slug).not.toContain('>');
  });

  it('slugify never returns empty', () => {
    expect(slugify('!!!').length).toBeGreaterThan(0);
    expect(slugify('')).toBe('x');
  });
});
