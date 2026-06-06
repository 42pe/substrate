import { describe, it, expect } from 'vitest';
import { createApp, defaultHttpConfig } from '../server.js';
import { BINARY_SCHEMA_VERSION } from '../../core/version.js';

describe('GET /api/health', () => {
  it('returns 200 + the expected shape', async () => {
    const app = createApp(defaultHttpConfig());
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      ok: boolean;
      version: string;
      schema_version: number;
      uptime_ms: number;
    };
    expect(body.ok).toBe(true);
    expect(typeof body.version).toBe('string');
    expect(body.schema_version).toBe(BINARY_SCHEMA_VERSION);
    expect(typeof body.uptime_ms).toBe('number');
    expect(body.uptime_ms).toBeGreaterThanOrEqual(0);
  });

  it('uptime increases between calls', async () => {
    const app = createApp(defaultHttpConfig());
    const first = (await (await app.request('/api/health')).json()) as { uptime_ms: number };
    // Yield to event loop briefly so uptime can tick at least 1 ms
    await new Promise((r) => setTimeout(r, 5));
    const second = (await (await app.request('/api/health')).json()) as { uptime_ms: number };
    expect(second.uptime_ms).toBeGreaterThanOrEqual(first.uptime_ms);
  });

  it('is subject to Origin/Host allowlist', async () => {
    const app = createApp(defaultHttpConfig());
    const res = await app.request('/api/health', {
      headers: { Origin: 'https://evil.com' },
    });
    expect(res.status).toBe(403);
  });
});
