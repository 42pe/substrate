import { describe, it, expect, afterEach } from 'vitest';
import { rmrf } from '../helpers/tmp.js';
import { mkdtemp, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { initCommand } from '../../src/cli/commands/init.js';
import { spawnCli, waitFor } from '../helpers/spawn.js';

/** Read the bound port from a project's serve.json runtime record (or null). */
async function readBoundPort(cwd: string): Promise<number | null> {
  try {
    const raw = await readFile(join(cwd, '.substrate', 'serve.json'), 'utf-8');
    const port = (JSON.parse(raw) as { port?: number }).port;
    return typeof port === 'number' ? port : null;
  } catch {
    return null;
  }
}

async function health(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Stop a spawned serve and wait for it to exit. SIGINT (not SIGKILL) is
 * deliberate: on the local `npx tsx` path `child` is the wrapper, and only a
 * forwardable signal reaches the nested node server — SIGKILL would orphan it
 * on the real port range. SIGINT drives the CLI's graceful shutdown (which also
 * removes the PID + port records). SIGKILL is only a last-resort backstop if the
 * graceful stop stalls.
 */
async function killAndWait(
  child: ChildProcess,
  signal: NodeJS.Signals = 'SIGINT',
): Promise<number | null> {
  if (child.exitCode !== null) return child.exitCode;
  const exited = new Promise<number | null>((resolve) => {
    child.once('exit', (code) => resolve(code));
  });
  child.kill(signal);
  const backstop = setTimeout(() => {
    if (child.exitCode === null) child.kill('SIGKILL');
  }, 5000);
  const code = await exited;
  clearTimeout(backstop);
  return code;
}

describe('substrate serve — multi-instance coexistence (integration)', () => {
  const children: ChildProcess[] = [];
  const dirs: string[] = [];

  afterEach(async () => {
    // Safety net for an early-throwing test: stop any survivors gracefully so we
    // never orphan a server onto the real port range.
    for (const c of children) {
      if (c.exitCode === null) await killAndWait(c, 'SIGINT').catch(() => undefined);
    }
    children.length = 0;
    for (const d of dirs) await rmrf(d).catch(() => undefined);
    dirs.length = 0;
  });

  // Windows skip mirrors the sibling serve-lifecycle suite (signal semantics).
  it.skipIf(process.platform === 'win32')(
    'two projects serve at once on distinct in-range ports, then clean up on shutdown',
    async () => {
      // Two independent projects, NEITHER pinned via SUBSTRATE_PORT_OVERRIDE, so
      // both exercise the real preferred-then-scan fallback.
      for (let i = 0; i < 2; i += 1) {
        const cwd = await mkdtemp(join(tmpdir(), 'substrate-coexist-'));
        dirs.push(cwd);
        await initCommand(cwd);
        children.push(spawnCli(['serve'], { cwd }));
      }
      const [cwd0, cwd1] = dirs as [string, string];

      // Both must record a bound port (i.e. both bound successfully).
      await waitFor(
        async () => (await readBoundPort(cwd0)) !== null && (await readBoundPort(cwd1)) !== null,
        { timeoutMs: 25_000 },
      );
      const p0 = await readBoundPort(cwd0);
      const p1 = await readBoundPort(cwd1);
      expect(p0).not.toBeNull();
      expect(p1).not.toBeNull();

      // Coexistence: distinct ports, both inside the fallback range.
      expect(p0).not.toBe(p1);
      for (const p of [p0!, p1!]) {
        expect(p).toBeGreaterThanOrEqual(7475);
        expect(p).toBeLessThanOrEqual(7499);
      }

      // Both actually answer on their bound port.
      await waitFor(() => health(p0!), { timeoutMs: 15_000 });
      await waitFor(() => health(p1!), { timeoutMs: 15_000 });
      expect(await health(p0!)).toBe(true);
      expect(await health(p1!)).toBe(true);

      // Graceful shutdown removes each project's port record (acceptance:
      // shutdown cleans up both the PID file and the new port record).
      for (const child of children) {
        expect(await killAndWait(child, 'SIGINT')).toBe(0);
      }
      expect(existsSync(join(cwd0, '.substrate', 'serve.json'))).toBe(false);
      expect(existsSync(join(cwd1, '.substrate', 'serve.json'))).toBe(false);
    },
    45_000,
  );
});
