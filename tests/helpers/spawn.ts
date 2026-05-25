import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { createServer } from 'node:net';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');
const CLI_ENTRY = resolve(REPO_ROOT, 'src', 'cli', 'index.ts');

/**
 * Spawn `tsx src/cli/index.ts <args>` as a child process. Returns the child.
 * The caller is responsible for killing it.
 *
 * Env vars on the child are inherited unless overridden via `env`.
 */
export function spawnCli(
  args: string[],
  opts: { cwd: string; env?: Record<string, string>; stdio?: 'pipe' | 'inherit' } = {
    cwd: process.cwd(),
  },
): ChildProcess {
  return spawn('npx', ['tsx', CLI_ENTRY, ...args], {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    stdio: opts.stdio ?? 'pipe',
  });
}

/**
 * Find a free TCP port (bind to 0, read the assigned port, close). Used by
 * integration tests via `SUBSTRATE_PORT_OVERRIDE` to avoid the fixed
 * port 7475 conflicting with parallel test runs.
 */
export async function findFreePort(): Promise<number> {
  return new Promise((resolveFn, rejectFn) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', rejectFn);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        srv.close(() => resolveFn(port));
      } else {
        rejectFn(new Error('Could not determine assigned port'));
      }
    });
  });
}

/**
 * Wait for a predicate to become true, polling at intervals. Throws on
 * timeout. Used by integration tests to wait for the spawned server to be
 * ready before sending real requests.
 */
export async function waitFor(
  predicate: () => Promise<boolean>,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const timeout = opts.timeoutMs ?? 10_000;
  const interval = opts.intervalMs ?? 100;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`Timed out after ${timeout}ms`);
}
