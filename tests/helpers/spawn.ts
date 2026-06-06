import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');
const CLI_ENTRY_TS = resolve(REPO_ROOT, 'src', 'cli', 'index.ts');
const CLI_ENTRY_JS = resolve(REPO_ROOT, 'dist', 'server', 'cli', 'index.js');

/**
 * Spawn the Substrate CLI as a child process. Returns the child; the caller
 * kills it.
 *
 * In CI we run the BUILT binary directly (`node dist/.../index.js`) rather than
 * `npx tsx src/cli/index.ts`. Two reasons the wrapper chain breaks under CI:
 *   1. Signals. `npx → tsx → node` means a SIGINT sent to the child hits the
 *      `npx` wrapper, not the node server, so it never shuts down (the lifecycle
 *      tests saw a null exit code + an afterEach kill timeout on Linux).
 *   2. Speed. A cold `npx tsx` compile per spawn blows the per-test timeout on a
 *      cold runner.
 * Running `node` on the prebuilt JS delivers signals straight to the process and
 * starts instantly — and exercises the actual shipped artifact. CI runs
 * `pnpm build` before `pnpm test`, so `dist/` is present. Locally (no `CI`, or
 * no build) we fall back to tsx-on-source so it's always current.
 *
 * Env vars on the child are inherited unless overridden via `env`.
 */
export function spawnCli(
  args: string[],
  opts: { cwd: string; env?: Record<string, string>; stdio?: 'pipe' | 'inherit' } = {
    cwd: process.cwd(),
  },
): ChildProcess {
  const useBuilt = !!process.env['CI'] && existsSync(CLI_ENTRY_JS);
  const [cmd, cmdArgs] = useBuilt
    ? ['node', [CLI_ENTRY_JS, ...args]]
    : ['npx', ['tsx', CLI_ENTRY_TS, ...args]];
  return spawn(cmd, cmdArgs, {
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
