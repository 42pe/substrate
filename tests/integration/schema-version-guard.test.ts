import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmrf } from '../helpers/tmp.js';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { initCommand } from '../../src/cli/commands/init.js';
import { openClient } from '../../src/storage/client.js';
import { spawnCli, findFreePort, waitFor } from '../helpers/spawn.js';

async function fetchOk(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    return res.ok;
  } catch {
    return false;
  }
}

describe('substrate serve — schema version guard (integration)', () => {
  let cwd: string;
  let port: number;
  let child: ChildProcess | null = null;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'substrate-guard-'));
    port = await findFreePort();
    await initCommand(cwd);
  });

  afterEach(async () => {
    if (child && child.exitCode === null) {
      child.kill('SIGKILL');
    }
    child = null;
    await rmrf(cwd);
  });

  it('starts cleanly when user_version == BINARY_SCHEMA_VERSION (positive path)', async () => {
    // initCommand already stamped user_version = BINARY_SCHEMA_VERSION (1).
    // This is the happy-path counterpart to the refuse-on-greater test below
    // — adding it explicitly so a future regression that breaks the equal
    // path can't silently pass while only the unit test catches it.
    child = spawnCli(['serve'], {
      cwd,
      env: { SUBSTRATE_PORT_OVERRIDE: String(port) },
    });

    await waitFor(() => fetchOk(port), { timeoutMs: 15_000 });

    expect(child.exitCode).toBeNull(); // still running

    child.kill('SIGINT');
    await new Promise<void>((resolve) => {
      child!.once('exit', () => resolve());
    });
  });

  it('refuses to start when data.sqlite user_version > BINARY_SCHEMA_VERSION', async () => {
    // Tamper: bump user_version to 999 to simulate a file written by a future binary
    const tamperClient = await openClient(join(cwd, '.substrate', 'data.sqlite'));
    try {
      await tamperClient.execute('PRAGMA user_version = 999');
    } finally {
      tamperClient.close();
    }

    // Spawn serve, capture stderr, wait for non-zero exit
    child = spawnCli(['serve'], {
      cwd,
      env: { SUBSTRATE_PORT_OVERRIDE: String(port) },
    });

    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const exitCode = await new Promise<number | null>((resolve) => {
      child!.once('exit', (code) => resolve(code));
      setTimeout(() => resolve(null), 15_000);
    });

    expect(exitCode).not.toBe(null);
    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(/schema v999/i);
    expect(stderr).toMatch(/upgrade|restore/i);
  });
});
