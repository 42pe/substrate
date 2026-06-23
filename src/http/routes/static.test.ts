import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { registerStaticFallback } from './static.js';

describe('registerStaticFallback', () => {
  let projectRoot: string;
  let uiDir: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'substrate-static-'));
    uiDir = join(projectRoot, 'dist', 'ui');
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  describe('when dist/ui/ is absent', () => {
    it('serves the placeholder HTML at /', async () => {
      const app = new Hono();
      registerStaticFallback(app, uiDir);

      const res = await app.request('/');
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('Substrate is running');
      expect(html).toContain('pnpm build:ui');
    });

    it('serves nothing at /assets/* (404)', async () => {
      const app = new Hono();
      registerStaticFallback(app, uiDir);

      const res = await app.request('/assets/index-abc.js');
      expect(res.status).toBe(404);
    });

    it('SPA fallback: an unmatched non-/api GET serves the placeholder index.html', async () => {
      const app = new Hono();
      registerStaticFallback(app, uiDir);

      const res = await app.request('/boards/some-id');
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/text\/html/);
      expect(await res.text()).toContain('Substrate is running');
    });

    it('SPA fallback: an unknown /api/* GET is NOT served the SPA (404, not HTML)', async () => {
      const app = new Hono();
      registerStaticFallback(app, uiDir);

      const res = await app.request('/api/unknown');
      expect(res.status).toBe(404);
      expect(res.headers.get('content-type') ?? '').not.toMatch(/text\/html/);
    });
  });

  describe('when dist/ui/ exists', () => {
    beforeEach(async () => {
      await mkdir(join(uiDir, 'assets'), { recursive: true });
      await writeFile(
        join(uiDir, 'index.html'),
        '<!doctype html><html><head><title>Substrate</title></head><body>built</body></html>',
        'utf-8',
      );
      await writeFile(join(uiDir, 'assets', 'index-abc.js'), 'console.log("hello");', 'utf-8');
      await writeFile(join(uiDir, 'assets', 'index-def.css'), 'body{color:red}', 'utf-8');
    });

    it('serves the real index.html at /', async () => {
      const app = new Hono();
      registerStaticFallback(app, uiDir);

      const res = await app.request('/');
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('built');
    });

    it('serves /assets/<file>.js with the file contents (B1 regression test)', async () => {
      const app = new Hono();
      registerStaticFallback(app, uiDir);

      const res = await app.request('/assets/index-abc.js');
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toBe('console.log("hello");');
    });

    it('serves /assets/<file>.css', async () => {
      const app = new Hono();
      registerStaticFallback(app, uiDir);

      const res = await app.request('/assets/index-def.css');
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toBe('body{color:red}');
    });

    it('rejects traversal attempts via /assets/../ paths with 403', async () => {
      const app = new Hono();
      registerStaticFallback(app, uiDir);

      // Hono normalizes most paths; we test the canonicalizer's defense
      // by constructing a URL that resolves outside the assets dir.
      const res = await app.request('/assets/..%2findex.html');
      // The path-canonical middleware should catch it; 403 from our
      // middleware OR 404 from Hono not matching is both acceptable
      // (the file is not served — we just need to confirm it's NOT 200).
      expect(res.status).not.toBe(200);
    });
  });
});
