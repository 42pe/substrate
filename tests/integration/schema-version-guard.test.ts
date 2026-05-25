import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { initCommand } from '../../src/cli/commands/init.js';
import { openClient } from '../../src/storage/client.js';
import { spawnCli, findFreePort } from '../helpers/spawn.js';

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
    await rm(cwd, { recursive: true, force: true });
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
