import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { originAllowlist } from './origin-allowlist.js';

const ALLOWED_ORIGINS = ['http://localhost:7475', 'http://127.0.0.1:7475'];
const ALLOWED_HOSTS = ['localhost:7475', '127.0.0.1:7475'];

function makeApp() {
  const app = new Hono();
  app.use('*', originAllowlist({ allowedOrigins: ALLOWED_ORIGINS, allowedHosts: ALLOWED_HOSTS }));
  app.get('/test', (c) => c.json({ ok: true }));
  return app;
}

describe('originAllowlist middleware', () => {
  describe('Origin header', () => {
    it('allows when absent', async () => {
      const app = makeApp();
      const res = await app.request('/test', {
        // No Origin header. Host left as the request default.
      });
      expect(res.status).toBe(200);
    });

    it('allows http://localhost:7475', async () => {
      const app = makeApp();
      const res = await app.request('/test', {
        headers: { Origin: 'http://localhost:7475', Host: 'localhost:7475' },
      });
      expect(res.status).toBe(200);
    });

    it('allows http://127.0.0.1:7475', async () => {
      const app = makeApp();
      const res = await app.request('/test', {
        headers: { Origin: 'http://127.0.0.1:7475', Host: '127.0.0.1:7475' },
      });
      expect(res.status).toBe(200);
    });

    it('rejects https://evil.com with 403 + forbidden envelope', async () => {
      const app = makeApp();
      const res = await app.request('/test', {
        headers: { Origin: 'https://evil.com', Host: 'localhost:7475' },
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as {
        ok: boolean;
        error: { code: string; message: string; details?: Record<string, unknown> };
      };
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('forbidden');
      expect(body.error.message).toMatch(/Origin/);
      expect(body.error.details).toEqual({ origin: 'https://evil.com' });
    });

    it('rejects an Origin that varies by case/protocol from the allowlist', async () => {
      const app = makeApp();
      // Different protocol (https vs http) — must NOT match
      const res = await app.request('/test', {
        headers: { Origin: 'https://localhost:7475', Host: 'localhost:7475' },
      });
      expect(res.status).toBe(403);
    });
  });

  describe('Host header (DNS rebinding defense)', () => {
    it('rejects Host: attacker.com even with allowed Origin', async () => {
      const app = makeApp();
      const res = await app.request('/test', {
        headers: { Origin: 'http://localhost:7475', Host: 'attacker.com' },
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: { code: string; details: { host: string } } };
      expect(body.error.code).toBe('forbidden');
      expect(body.error.details.host).toBe('attacker.com');
    });

    it('rejects Host: external.example.com:7475 (wrong domain even with right port)', async () => {
      const app = makeApp();
      const res = await app.request('/test', {
        headers: { Host: 'external.example.com:7475' },
      });
      expect(res.status).toBe(403);
    });
  });

  describe('curl / server-to-server (no Origin, no Host)', () => {
    it('allows requests with neither header (Host is required by HTTP/1.1 but Hono test client may omit it)', async () => {
      const app = makeApp();
      const res = await app.request('/test');
      expect(res.status).toBe(200);
    });
  });
});
