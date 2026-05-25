import type { Hono } from 'hono';
import { BINARY_SCHEMA_VERSION } from '../../core/version.js';

/**
 * GET /api/health — liveness probe and version surface.
 *
 * Returns the binary's version, the schema version it expects, and uptime
 * in milliseconds since process start. Useful to:
 *  - confirm the server is up (Phase 1 manual + smoke tests)
 *  - verify after `pnpm build` that the production bundle starts
 *  - sanity-check schema_version between binary and the data.sqlite
 *    (Phase 4 `substrate diagnose` will surface a richer comparison)
 *
 * Reads `process.env.npm_package_version` as the version source. Falls
 * back to '0.0.0' for environments where the env isn't set (e.g., when
 * the binary is invoked via the compiled CLI rather than `pnpm`).
 */
export function registerHealthRoute(app: Hono, startedAtMs: number): void {
  app.get('/api/health', (c) => {
    return c.json({
      ok: true,
      version: process.env['npm_package_version'] ?? '0.0.0',
      schema_version: BINARY_SCHEMA_VERSION,
      uptime_ms: Date.now() - startedAtMs,
    });
  });
}
