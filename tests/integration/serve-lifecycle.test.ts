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
