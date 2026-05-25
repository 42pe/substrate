import type { Hono } from 'hono';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

/**
 * Phase 1 fallback for non-API routes.
 *
 * If `dist/ui/index.html` exists (built UI is bundled), serve it. The full
 * static-asset serving (CSS, JS chunks, fonts) lands in Phase 5 when the
 * UI ships beyond hello-world. For now, the single index.html is enough to
 * demonstrate the build pipeline composes.
 *
 * If `dist/ui/` is absent (developer hasn't built UI yet, or the binary is
 * running in dev mode before any UI was built), return a plain HTML
 * placeholder that confirms the server is alive and tells the user how to
 * build the UI.
 */
const PLACEHOLDER_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Substrate</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; padding: 2rem; max-width: 40rem; line-height: 1.5; color: #333; }
    code { background: #f4f4f4; padding: 0.1rem 0.3rem; border-radius: 3px; font-size: 0.95em; }
    .muted { color: #666; }
  </style>
</head>
<body>
  <h1>Substrate is running</h1>
  <p>The HTTP server is up. The web UI is not built yet.</p>
  <p>To build the UI, run <code>pnpm build:ui</code>. Then refresh this page.</p>
  <p class="muted">Phase 1 walking skeleton. Full UI lands in Phase 5.</p>
</body>
</html>
`;

export function registerStaticFallback(app: Hono, projectRoot: string): void {
  const indexHtmlPath = resolve(projectRoot, 'dist', 'ui', 'index.html');

  app.get('/', (c) => {
    if (existsSync(indexHtmlPath)) {
      const html = readFileSync(indexHtmlPath, 'utf-8');
      return c.html(html);
    }
    return c.html(PLACEHOLDER_HTML);
  });

  // Phase 5 will add proper static-asset routing for /assets/*, /favicon.ico,
  // etc. once Vite produces them. Phase 1 only needs the index fallback.

  // Suppress unused-import warning for `join` (Phase 5 will use it for asset paths).
  void join;
}
