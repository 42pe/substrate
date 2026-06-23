import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initCommand } from './init.js';
import { backupCommand } from './backup.js';
import { exportCommand } from './export.js';
import { importCommand } from './import.js';
import { diagnoseCommand } from './diagnose.js';
import { paths, substrateRootFromCwd } from '../../shared/paths.js';

function silenceStdout() {
  return vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
}

describe('backup / export / import / diagnose CLIs', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'substrate-lifecycle-'));
    await initCommand(cwd);
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it('backup writes a tarball into .substrate/backups/', async () => {
    const spy = silenceStdout();
    await backupCommand(cwd);
    spy.mockRestore();
    const { readdir } = await import('node:fs/promises');
    const baks = await readdir(join(substrateRootFromCwd(cwd), 'backups'));
    expect(baks.some((f) => f.endsWith('.tar.gz'))).toBe(true);
  });

  it('export → import round-trips into a fresh project', async () => {
    const spy = silenceStdout();
    const archivePath = join(cwd, 'out.tar.gz');
    await exportCommand(cwd, 'out.tar.gz');
    expect(existsSync(archivePath)).toBe(true);

    const dest = await mkdtemp(join(tmpdir(), 'substrate-restore-'));
    try {
      await importCommand(dest, archivePath, false);
      expect(existsSync(paths(substrateRootFromCwd(dest)).config)).toBe(true);
    } finally {
      await rm(dest, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
    spy.mockRestore();
  });

  it('import refuses to overwrite an existing project without --force', async () => {
    const spy = silenceStdout();
    await exportCommand(cwd, 'out.tar.gz');
    spy.mockRestore();
    await expect(importCommand(cwd, join(cwd, 'out.tar.gz'), false)).rejects.toMatchObject({
      code: 'conflict',
    });
  });

  it('import refuses when a live PID owns the directory', async () => {
    const spy = silenceStdout();
    await exportCommand(cwd, 'out.tar.gz');
    spy.mockRestore();
    // Write a PID file pointing at THIS (alive) process.
    await mkdir(substrateRootFromCwd(cwd), { recursive: true });
    await writeFile(paths(substrateRootFromCwd(cwd)).pid, String(process.pid), 'utf-8');
    await expect(importCommand(cwd, join(cwd, 'out.tar.gz'), true)).rejects.toMatchObject({
      code: 'conflict',
    });
  });

  it('diagnose reports no problems on a healthy substrate', async () => {
    const saved = process.exitCode;
    const spy = silenceStdout();
    await diagnoseCommand(cwd);
    spy.mockRestore();
    expect(process.exitCode === undefined || process.exitCode === 0).toBe(true);
    process.exitCode = saved;
  });

  it('diagnose reports problems on a broken substrate without throwing', async () => {
    const saved = process.exitCode;
    const broken = await mkdtemp(join(tmpdir(), 'substrate-broken-'));
    // Garbage config.json, no DB.
    await mkdir(join(broken, '.substrate'), { recursive: true });
    await writeFile(join(broken, '.substrate', 'config.json'), '{not json', 'utf-8');
    const spy = silenceStdout();
    await expect(diagnoseCommand(broken)).resolves.toBeUndefined(); // never throws
    spy.mockRestore();
    expect(process.exitCode).toBe(1);
    process.exitCode = saved;
    await rm(broken, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });
});
