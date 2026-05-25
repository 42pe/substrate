import type { Hono } from 'hono';
import { BINARY_SCHEMA_VERSION, BINARY_VERSION } from '../../core/version.js';

/**
 * GET /api/health — liveness probe and version surface.
 *
 * Returns the binary's version, the schema version it expects, and process
 * uptime in milliseconds.
 *
 * Uses `process.uptime() * 1000` rather than tracking "since createApp was
 * called" — health is about whether the *process* is alive and how long
 * it's been up, not how long this particular Hono instance has been built.
 * Reviewer C5 fix.
 */
export function registerHealthRoute(app: Hono): void {
  app.get('/api/health', (c) => {
    return c.json({
      ok: true,
      version: BINARY_VERSION,
      schema_version: BINARY_SCHEMA_VERSION,
      uptime_ms: Math.round(process.uptime() * 1000),
    });
  });
}
