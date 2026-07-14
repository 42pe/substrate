import { Hono } from 'hono';
import { serve, type ServerType } from '@hono/node-server';
import { originAllowlist } from './middleware/origin-allowlist.js';
import { errorHandler } from './middleware/error-handler.js';
import { registerHealthRoute } from './routes/health.js';
import { registerStaticFallback } from './routes/static.js';
import { registerApiRoutes, type ApiDeps } from './routes/api/index.js';

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
   * Explicit override for the built-UI directory (`dist/ui`). Normally omitted:
   * the static route locates `dist/ui` relative to the BINARY (where the package
   * is installed), NOT the user's cwd — so `serve` works from any project dir.
   * Tests pass an explicit dir. (Pre-0.2.1 this was `projectRoot` = cwd, which
   * broke `serve` from any directory other than the Substrate repo root.)
   */
  uiDir?: string;
  /**
   * Read-API dependencies (Phase 5a). When present, the `/api` read routes are
   * mounted. Omitted in health-only / static-only test apps. No `root` — the
   * HTTP surface is reads-only and structurally can't reach the write path.
   */
  apiDeps?: ApiDeps;
}

export const DEFAULT_PORT = 7475;

/**
 * Free-port fallback range for `substrate serve` (multi-instance coexistence).
 * The preferred port (`DEFAULT_PORT`) is always tried first; on conflict, serve
 * scans upward through `PORT_RANGE_START..PORT_RANGE_END` (inclusive) for the
 * first free port so a second project can serve while the first is up. Single
 * source of truth — serve + diagnose both import these.
 */
export const PORT_RANGE_START = 7475;
export const PORT_RANGE_END = 7499;

export function defaultHttpConfig(): HttpConfig {
  return {
    port: DEFAULT_PORT,
    allowedOrigins: [`http://localhost:${DEFAULT_PORT}`, `http://127.0.0.1:${DEFAULT_PORT}`],
    allowedHosts: [`localhost:${DEFAULT_PORT}`, `127.0.0.1:${DEFAULT_PORT}`],
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

  // Routes. The read API mounts BEFORE the static fallback so a future
  // client-side-routing catch-all in the SPA can't shadow `/api` (the static
  // route is `/` + `/assets/*` only today, so there's no shadowing yet).
  registerHealthRoute(app);
  if (config.apiDeps) {
    registerApiRoutes(app, config.apiDeps);
  }
  registerStaticFallback(app, config.uiDir);

  // Top-level error handler — catches anything thrown from routes/middleware
  // that wasn't already turned into a Response.
  app.onError(errorHandler);

  return app;
}

/**
 * Bind the Hono app to a TCP port on 127.0.0.1 and resolve only after the
 * server is actually listening. Rejects on bind errors (EADDRINUSE, EACCES,
 * etc.) by way of the underlying http.Server's `'error'` event.
 *
 * `@hono/node-server`'s `serve()` returns synchronously, but EADDRINUSE
 * fires asynchronously on the server's `'error'` event. A naive try/catch
 * around `serve()` will NOT catch it — the original Phase 1 code was
 * silently broken on port conflicts. Reviewer B-1 fix.
 *
 * Listens on 127.0.0.1 only — never on 0.0.0.0 — per PRD §3 (no remote
 * access in v1).
 *
 * Returns a Promise<ServerType> so callers can close it cleanly on shutdown.
 */
export function startHttpServer(app: Hono, port: number): Promise<ServerType> {
  return new Promise((resolve, reject) => {
    const server: ServerType = serve(
      {
        fetch: app.fetch,
        port,
        hostname: '127.0.0.1',
      },
      () => resolve(server),
    );
    server.once('error', reject);
  });
}

/**
 * Promise-wrap server.close(). Node's `http.Server.close()` stops accepting new
 * connections, then waits for EXISTING connections to finish before its callback
 * fires. A browser tab keeps an idle keep-alive socket open, so `close()` would
 * otherwise never complete and `Ctrl+C` hangs at "shutting down".
 *
 * Fix: after requesting close, force-drop all open sockets with
 * `closeAllConnections()` (Node ≥18.2) so the callback can fire promptly. We
 * also resolve after a short grace timeout as a belt-and-suspenders backstop, so
 * shutdown can never wedge regardless of socket state.
 */
export function closeHttpServer(server: ServerType): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      resolve();
    };
    server.close(() => finish());
    // Drop idle/keep-alive sockets (e.g. an open browser tab) so close() fires.
    (server as { closeAllConnections?: () => void }).closeAllConnections?.();
    // Backstop: never wedge if a socket refuses to die.
    setTimeout(finish, 2000).unref();
  });
}
