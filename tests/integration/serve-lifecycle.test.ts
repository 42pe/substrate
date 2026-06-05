import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { initCommand } from '../../src/cli/commands/init.js';
import { spawnCli, findFreePort, waitFor } from '../helpers/spawn.js';

async function fetchOk(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    return res.ok;
  } catch {
    return false;
  }
}

async function killAndWait(
  child: ChildProcess,
  signal: NodeJS.Signals = 'SIGINT',
): Promise<number | null> {
  if (child.exitCode !== null) return child.exitCode;
  const exitPromise = new Promise<number | null>((resolve) => {
    child.once('exit', (code) => resolve(code));
  });
  child.kill(signal);
  // Fallback: force kill after 5 seconds
  const timeoutId = setTimeout(() => {
    if (child.exitCode === null) child.kill('SIGKILL');
  }, 5000);
  const code = await exitPromise;
  clearTimeout(timeoutId);
  return code;
}

describe('substrate serve — lifecycle (integration)', () => {
  let cwd: string;
  let port: number;
  let child: ChildProcess | null = null;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'substrate-serve-'));
    port = await findFreePort();
    await initCommand(cwd);
  });

  afterEach(async () => {
    if (child && child.exitCode === null) {
      await killAndWait(child, 'SIGKILL').catch(() => undefined);
    }
    child = null;
    await rm(cwd, { recursive: true, force: true });
  });

  it('starts, serves /api/health, then exits cleanly on SIGINT', async () => {
    child = spawnCli(['serve'], {
      cwd,
      env: { SUBSTRATE_PORT_OVERRIDE: String(port) },
    });

    // Wait for server to be listening
    await waitFor(() => fetchOk(port), { timeoutMs: 15_000 });

    // Verify PID file exists and contains a valid integer.
    // NOTE: we don't compare to `child.pid` because `npx tsx` spawns a chain
    // (npx → tsx → node), and `child.pid` is the outer npx wrapper while
    // the PID written to .substrate/substrate.pid is the deeply-nested
    // Node process that actually runs the CLI code.
    const pidFile = join(cwd, '.substrate', 'substrate.pid');
    expect(existsSync(pidFile)).toBe(true);
    const pidContent = await readFile(pidFile, 'utf-8');
    const pidInFile = parseInt(pidContent.trim(), 10);
    expect(Number.isFinite(pidInFile)).toBe(true);
    expect(pidInFile).toBeGreaterThan(0);

    // SIGINT → clean exit
    const code = await killAndWait(child, 'SIGINT');
    expect(code).toBe(0);

    // PID file should be removed
    expect(existsSync(pidFile)).toBe(false);
  });

  it('refuses to start a second instance from the same directory', async () => {
    child = spawnCli(['serve'], {
      cwd,
      env: { SUBSTRATE_PORT_OVERRIDE: String(port) },
    });
    await waitFor(() => fetchOk(port), { timeoutMs: 15_000 });

    // Second instance with a different port (so port-conflict isn't the trigger)
    const port2 = await findFreePort();
    const second = spawnCli(['serve'], {
      cwd,
      env: { SUBSTRATE_PORT_OVERRIDE: String(port2) },
    });

    // Collect stderr
    let stderr = '';
    second.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const code = await new Promise<number | null>((resolve) => {
      second.once('exit', (c) => resolve(c));
      setTimeout(() => resolve(null), 10_000); // safety
    });

    expect(code).not.toBe(0);
    expect(stderr).toMatch(/already running/i);
  });

  it('serves the read API over a bound port (GET /api/project)', async () => {
    child = spawnCli(['serve'], { cwd, env: { SUBSTRATE_PORT_OVERRIDE: String(port) } });
    await waitFor(() => fetchOk(port), { timeoutMs: 15_000 });
    const res = await fetch(`http://127.0.0.1:${port}/api/project`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { project_id: string };
    expect(body.project_id).toMatch(/^[0-9a-f]{8}-/i);
  });

  it('reclaims a stale PID file (dead process) and starts cleanly', async () => {
    // Simulate an ungraceful prior exit: a PID file pointing at a dead process.
    const { writeFile, mkdir } = await import('node:fs/promises');
    const pidFile = join(cwd, '.substrate', 'substrate.pid');
    await mkdir(join(cwd, '.substrate'), { recursive: true });
    await writeFile(pidFile, '2147483646', 'utf-8'); // almost-certainly-dead pid

    child = spawnCli(['serve'], { cwd, env: { SUBSTRATE_PORT_OVERRIDE: String(port) } });
    // If reclaim works, the server comes up and serves health.
    await waitFor(() => fetchOk(port), { timeoutMs: 15_000 });
    expect(await fetchOk(port)).toBe(true);
    // The PID file now holds the live server's pid (reclaimed + rewritten).
    const pid = parseInt((await readFile(pidFile, 'utf-8')).trim(), 10);
    expect(pid).not.toBe(2147483646);
  });
});

describe('substrate serve — port conflict (integration; B-1 regression test)', () => {
  let cwd1: string;
  let cwd2: string;
  let port: number;
  let child1: ChildProcess | null = null;
  let child2: ChildProcess | null = null;

  beforeEach(async () => {
    cwd1 = await mkdtemp(join(tmpdir(), 'substrate-port1-'));
    cwd2 = await mkdtemp(join(tmpdir(), 'substrate-port2-'));
    port = await findFreePort();
    await initCommand(cwd1);
    await initCommand(cwd2);
  });

  afterEach(async () => {
    for (const c of [child1, child2]) {
      if (c && c.exitCode === null) {
        await killAndWait(c, 'SIGKILL').catch(() => undefined);
      }
    }
    child1 = null;
    child2 = null;
    await rm(cwd1, { recursive: true, force: true });
    await rm(cwd2, { recursive: true, force: true });
  });

  it('refuses to start with a clear stderr error when the port is taken (EADDRINUSE)', async () => {
    // First instance grabs the port
    child1 = spawnCli(['serve'], {
      cwd: cwd1,
      env: { SUBSTRATE_PORT_OVERRIDE: String(port) },
    });
    await waitFor(() => fetchOk(port), { timeoutMs: 15_000 });

    // Second instance, DIFFERENT cwd (so PID-file path is different),
    // SAME port → should hit EADDRINUSE and report clearly.
    child2 = spawnCli(['serve'], {
      cwd: cwd2,
      env: { SUBSTRATE_PORT_OVERRIDE: String(port) },
    });

    let stderr = '';
    child2.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const code = await new Promise<number | null>((resolve) => {
      child2!.once('exit', (c) => resolve(c));
      setTimeout(() => resolve(null), 10_000);
    });

    expect(code).not.toBe(0);
    expect(stderr).toMatch(/already in use|EADDRINUSE/i);
  });
});

describe('substrate serve — missing .substrate/ (integration)', () => {
  let cwd: string;
  let port: number;
  let child: ChildProcess | null = null;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'substrate-serve-empty-'));
    port = await findFreePort();
    // NOTE: deliberately not running initCommand here
  });

  afterEach(async () => {
    if (child && child.exitCode === null) {
      await killAndWait(child, 'SIGKILL').catch(() => undefined);
    }
    child = null;
    await rm(cwd, { recursive: true, force: true });
  });

  it('exits non-zero with a clear error when .substrate/ is missing', async () => {
    child = spawnCli(['serve'], {
      cwd,
      env: { SUBSTRATE_PORT_OVERRIDE: String(port) },
    });

    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const code = await new Promise<number | null>((resolve) => {
      child!.once('exit', (c) => resolve(c));
      setTimeout(() => resolve(null), 10_000);
    });

    expect(code).not.toBe(0);
    expect(stderr).toMatch(/substrate init/i);
  });
});
