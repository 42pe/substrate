import type { Hono } from 'hono';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, extname, join } from 'node:path';

/**
 * Phase 1 static route — serves the built Vite UI when present.
 *
 * Vite produces:
 *   - dist/ui/index.html               served at `/`
 *   - dist/ui/assets/<hashed>.js       served at `/assets/<hashed>.js`
 *   - dist/ui/assets/<hashed>.css      served at `/assets/<hashed>.css`
 *
 * Without serving `/assets/*` the browser loads `index.html` and then 404s
 * on its referenced JS/CSS — the page renders as a blank `<div id="root">`.
 * Reviewer B1 fix.
 *
 * Implementation: at registration time, scan `dist/ui/assets/` and load
 * every file into memory (Phase 1 UI is ~200 KB total). Requests to
 * `/assets/<file>` look the file up in the map and serve it directly. No
 * per-request fs IO. No path-traversal surface — the map is built from
 * exactly the files inside `assets/`, so a crafted `/assets/../etc/passwd`
 * request will not match any key. Trade-off: a UI re-built after the
 * server starts requires a server restart to be picked up. Acceptable for
 * Phase 1; Vite dev mode is the workflow for live reload.
 *
 * If `dist/ui/` is absent, the placeholder HTML below tells the user how
 * to build it. The placeholder body has no user input and no inline
 * scripts — CSP-friendly out of the box.
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
  <p>The server is up, but the web UI assets weren't found in this install.</p>
  <p>If you installed Substrate from npm, this shouldn't happen — please
     <a href="https://github.com/42pe/substrate/issues">file an issue</a> with the output of
     <code>substrate diagnose</code>.</p>
  <p class="muted">Developing from source? Run <code>pnpm build:ui</code>, then restart the server.</p>
</body>
</html>
`;

const CONTENT_TYPE_BY_EXT: Readonly<Record<string, string>> = {
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function loadAssetsRecursive(dir: string, prefix: string, map: Map<string, Buffer>): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    const relUrl = `${prefix}/${entry}`;
    if (st.isDirectory()) {
      loadAssetsRecursive(full, relUrl, map);
    } else if (st.isFile()) {
      map.set(relUrl, readFileSync(full));
    }
  }
}

/**
 * Locate the built `dist/ui` directory relative to THIS compiled file (i.e. the
 * binary/install), not the user's cwd — so `serve` finds the UI from any project
 * directory. Two layouts:
 *   - installed/built: `dist/server/http/routes/static.js` → `../../../ui` = `dist/ui`
 *   - dev via tsx:      `src/http/routes/static.ts`        → `../../../dist/ui`
 * Tests pass an explicit `uiDir` to bypass this search.
 */
function defaultUiDir(): string {
  const here = import.meta.dirname;
  const candidates = [
    resolve(here, '..', '..', '..', 'ui'), // built/installed: dist/server/http/routes → dist/ui
    resolve(here, '..', '..', '..', 'dist', 'ui'), // dev via tsx: src/http/routes → <repo>/dist/ui
  ];
  // A BUILT UI has both index.html AND an assets/ dir. The UI *source* dir
  // (`<repo>/ui`) also has an index.html (referencing /src/main.tsx) but no
  // assets/ — requiring assets/ rejects it, so dev (tsx) doesn't serve the
  // unbuilt source index.
  const built = (d: string): boolean =>
    existsSync(join(d, 'index.html')) && existsSync(join(d, 'assets'));
  return candidates.find(built) ?? candidates[0]!;
}

export function registerStaticFallback(app: Hono, uiDirOverride?: string): void {
  const uiDir = uiDirOverride ?? defaultUiDir();
  const indexHtmlPath = resolve(uiDir, 'index.html');
  const assetsDir = resolve(uiDir, 'assets');

  // Load index.html once at registration time
  const indexHtml: string = existsSync(indexHtmlPath)
    ? readFileSync(indexHtmlPath, 'utf-8')
    : PLACEHOLDER_HTML;

  // Load every asset under /assets/ once at registration time (B1 fix)
  const assetMap = new Map<string, Buffer>();
  loadAssetsRecursive(assetsDir, '/assets', assetMap);

  // `/` is also covered by the SPA catch-all below; kept for intent clarity.
  app.get('/', (c) => c.html(indexHtml));

  app.get('/assets/*', (c) => {
    const requestedPath = decodeURIComponent(c.req.path);
    const body = assetMap.get(requestedPath);
    if (!body) return c.notFound();
    const ext = extname(requestedPath).toLowerCase();
    const contentType = CONTENT_TYPE_BY_EXT[ext] ?? 'application/octet-stream';
    return c.body(new Uint8Array(body), 200, { 'Content-Type': contentType });
  });

  // SPA fallback (Phase 5b): serve index.html for any other GET so client-side
  // deep links (`/boards/:id`, `/tasks/:id`) load the app. Registered LAST, so
  // it only matches paths no earlier route claimed. CRITICAL: never serve the
  // SPA for an unknown `/api/*` path — those must 404 (JSON-ish), not HTML, so
  // a typo'd API call doesn't silently get an HTML 200. The registered `/api`
  // routes (in createApp, before this) are matched first; this guard catches
  // the UNKNOWN ones.
  app.get('*', (c) => {
    if (c.req.path.startsWith('/api/')) return c.notFound();
    return c.html(indexHtml);
  });
}
