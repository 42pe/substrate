import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, cp } from 'node:fs/promises';
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
  // The static route serves <cwd>/dist/ui — copy the real build in so the
  // smoke exercises the actual app, not the "not built yet" placeholder.
  await cp(join(REPO_ROOT, 'dist', 'ui'), join(tempDir, 'dist', 'ui'), { recursive: true });

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

test('overview (/) renders the project and its boards', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto(`${baseURL}/`);
  // The project name (h1) is derived from the init dir; assert structure +
  // that the seeded board loaded from the API as a card link.
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Roadmap' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('boards (/boards) lists boards', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto(`${baseURL}/boards`);
  await expect(page.getByRole('heading', { name: 'Boards', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Roadmap' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('board detail (/boards/:id) shows groups, policies, and tasks', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto(`${baseURL}/boards/main`);
  await expect(page.getByRole('heading', { name: 'Roadmap', level: 1 })).toBeVisible();
  await expect(page.getByText('To do').first()).toBeVisible();
  await expect(page.getByText('No skipping review')).toBeVisible();
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
