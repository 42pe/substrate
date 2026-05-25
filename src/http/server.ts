import { Hono } from 'hono';
import { serve, type ServerType } from '@hono/node-server';
import { originAllowlist } from './middleware/origin-allowlist.js';
import { errorHandler } from './middleware/error-handler.js';
import { registerHealthRoute } from './routes/health.js';
import { registerStaticFallback } from './routes/static.js';

/**
 * HTTP server configuration. Locked defaults: port 7475, localhost-only.
 *
 * Origin/Host allowlists default to the local server's own URLs. The port
 * is currently pinned (no `--port` CLI flag in v1 per PRD §6.3); when a
 * future v1.x flag lands, also derive the allowlist from it.
 */
export interface HttpConfig {
  port: number;
  allowedOrigins: readonly string[];
  allowedHosts: readonly string[];
  /**
   * Repo root — used by the static fallback route to locate dist/ui/.
   * Typically `process.cwd()` at the CLI invocation time.
   */
  projectRoot: string;
}

export const DEFAULT_PORT = 7475;

export function defaultHttpConfig(projectRoot: string): HttpConfig {
  return {
    port: DEFAULT_PORT,
    allowedOrigins: [`http://localhost:${DEFAULT_PORT}`, `http://127.0.0.1:${DEFAULT_PORT}`],
    allowedHosts: [`localhost:${DEFAULT_PORT}`, `127.0.0.1:${DEFAULT_PORT}`],
    projectRoot,
  };
}

/**
 * Build a configured Hono app. Pure factory — no side effects (no listening,
 * no fs writes). Useful for unit/integration tests that use `app.request()`
 * without binding a port.
 */
export function createApp(config: HttpConfig): Hono {
  const app = new Hono();

  // Middleware order matters: security gate runs before any route.
  app.use(
    '*',
    originAllowlist({
      allowedOrigins: config.allowedOrigins,
      allowedHosts: config.allowedHosts,
    }),
  );

  // Routes
  registerHealthRoute(app);
  registerStaticFallback(app, config.projectRoot);

  // Top-level error handler — catches anything thrown from routes/middleware
  // that wasn't already turned into a Response.
  app.onError(errorHandler);

  return app;
}

/**
 * Bind the Hono app to a TCP port on 127.0.0.1. Returns the ServerType from
 * @hono/node-server so the caller can close it cleanly on shutdown.
 *
 * Listens on 127.0.0.1 only — never on 0.0.0.0 — per PRD §3 (no remote
 * access in v1).
 */
export function startHttpServer(app: Hono, port: number): ServerType {
  return serve({
    fetch: app.fetch,
    port,
    hostname: '127.0.0.1',
  });
}
