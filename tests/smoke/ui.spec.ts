import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';

/**
 * Phase 5b UI smoke. Boots the REAL stack (built `dist/ui` + the Phase 5a HTTP
 * read API over a seeded `.substrate/`) in a child process, then drives a real
 * Chromium over the four routes. Asserts a known element mounts on each and
 * that the page logged zero console errors / page errors — the proof that the
 * client renders against the live API, not mocks.
 */

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');
const TSX_BIN = resolve(REPO_ROOT, 'node_modules', '.bin', 'tsx');
const SEED_SCRIPT = resolve(REPO_ROOT, 'tests', 'smoke', 'ui-seed-and-serve.ts');

let server: ChildProcess;
let tempDir: string;
let baseURL: string;

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.once('error', rej);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr === null || typeof addr === 'string') {
        rej(new Error('could not determine free port'));
        return;
      }
      const port = addr.port;
      srv.close(() => res(port));
    });
  });
}

async function waitForHealth(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${url}/api/health`);
      if (r.ok) return;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((res) => setTimeout(res, 200));
  }
  throw new Error(`server did not become healthy at ${url}: ${String(lastErr)}`);
}

test.beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'substrate-ui-smoke-'));
  // The static route resolves dist/ui relative to the BINARY (here: the repo,
  // since the fixture runs the CLI via tsx on src), so the smoke serves the
  // real build with no per-cwd copy. `test:smoke:ui` runs `pnpm build:ui` first.

  const port = await freePort();
  baseURL = `http://127.0.0.1:${port}`;

  server = spawn(TSX_BIN, [SEED_SCRIPT, tempDir, String(port)], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'inherit', 'inherit'],
  });

  await waitForHealth(baseURL, 20_000);
});

test.afterAll(async () => {
  if (server && server.exitCode === null) {
    await new Promise<void>((res) => {
      server.once('exit', () => res());
      server.kill('SIGTERM');
      // Hard-stop fallback if the child ignores SIGTERM.
      setTimeout(() => {
        if (server.exitCode === null) server.kill('SIGKILL');
        res();
      }, 5_000);
    });
  }
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

/** Attach console/page-error collectors; benign favicon noise is ignored. */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' && !msg.text().toLowerCase().includes('favicon')) {
      errors.push(msg.text());
    }
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

test('overview (/) renders a live multi-board wall', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto(`${baseURL}/`);
  // The project name (h1) is derived from the init dir. The seeded board shows
  // as a strip: its name links to the board, with a column and a task card
  // loaded from the new /columns endpoint, plus the live-polling indicator.
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Roadmap' })).toBeVisible();
  await expect(page.getByText('To do').first()).toBeVisible(); // a column
  await expect(page.getByRole('link', { name: 'Design' })).toBeVisible(); // a card
  await expect(page.locator('[aria-live="polite"]').first()).toBeVisible(); // live indicator
  expect(errors).toEqual([]);
});

test('boards (/boards) lists boards', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto(`${baseURL}/boards`);
  await expect(page.getByRole('heading', { name: 'Boards', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Roadmap' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('activity (/activity) renders the cross-board event feed', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto(`${baseURL}/activity`);
  await expect(page.getByRole('heading', { name: 'Activity', level: 1 })).toBeVisible();
  // The seed appends a `created` event for task "Design"; the feed row links to it.
  await expect(page.getByRole('link', { name: 'Design' })).toBeVisible();
  await expect(page.locator('[aria-live="polite"]').first()).toBeVisible(); // live indicator
  expect(errors).toEqual([]);
});

test('board detail (/boards/:id) renders a kanban with a working List toggle', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto(`${baseURL}/boards/main`);
  await expect(page.getByRole('heading', { name: 'Roadmap', level: 1 })).toBeVisible();
  // Kanban (default): a column per group (heading) + a task card link; live on.
  await expect(page.getByRole('heading', { name: 'To do' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Done' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Design' })).toBeVisible();
  await expect(page.locator('[aria-live="polite"]').first()).toBeVisible();
  // Kanban has no <table>; the demoted policy lives in a collapsed disclosure.
  await expect(page.getByRole('table')).toHaveCount(0);
  // The policy is reachable by expanding "Board details".
  await page.getByText(/Board details/).click();
  await expect(page.getByText('No skipping review')).toBeVisible();
  // Toggle to List → the task table renders.
  await page.getByRole('link', { name: 'List' }).click();
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Design' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('task detail (/tasks/:id) shows the task and a sanitized comment', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto(`${baseURL}/tasks/t1`);
  await expect(page.getByRole('heading', { name: 'Design', level: 1 })).toBeVisible();

  // Markdown render path: description bold renders as a real <strong>.
  await expect(page.locator('strong', { hasText: 'Design' }).first()).toBeVisible();

  // Comments tab → seeded comment body renders through <Markdown> (the bold
  // word "comment" becomes a real <strong>, distinct from the "Comments" tab).
  await page.getByRole('tab', { name: 'Comments' }).click();
  await expect(page.getByText('comment', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
