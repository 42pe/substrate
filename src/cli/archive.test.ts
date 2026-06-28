import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmrf } from '../../tests/helpers/tmp.js';
import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { create as tarCreate } from 'tar';
import { writeConfig } from '../shared/config.js';
import { paths } from '../shared/paths.js';
import { openDatabaseAndMigrate } from '../storage/client.js';
import { createSubstrateArchive, extractSubstrateArchive, assertArchiveSafe } from './archive.js';
import type { Config } from '../core/types.js';

const config: Config = {
  project_id: '11111111-1111-4111-8111-111111111111',
  project_name: 'Proj',
  description: '',
  version: 1,
  schema_version: 2,
  created_at: '2026-05-09T00:00:00.000Z',
};

describe('substrate archive', () => {
  let dir: string;
  let root: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'substrate-archive-'));
    root = join(dir, '.substrate');
    await writeConfig(root, config);
    await mkdir(paths(root).boardsDir, { recursive: true });
    await writeFile(paths(root).boardJson('b1'), '{"id":"b1"}', 'utf-8');
    const client = await openDatabaseAndMigrate(paths(root).dataSqlite);
    client.close();
  });
  afterEach(async () => {
    await rmrf(dir);
  });

  it('creates an archive and round-trips it via extract into a fresh root', async () => {
    const out = join(dir, 'backup.tar.gz');
    await createSubstrateArchive(root, out);
    expect(existsSync(out)).toBe(true);

    const target = join(dir, 'restored', '.substrate');
    await extractSubstrateArchive(out, target);
    const restoredConfig = JSON.parse(await readFile(join(target, 'config.json'), 'utf-8'));
    expect(restoredConfig.project_id).toBe(config.project_id);
    expect(existsSync(join(target, 'boards', 'b1.json'))).toBe(true);
    expect(existsSync(join(target, 'data.sqlite'))).toBe(true);
    // transient files excluded
    const names = await readdir(target);
    expect(names).not.toContain('substrate.pid');
  });

  it('rejects a zip-slip archive (entry escaping the target)', async () => {
    // Craft a malicious tarball with a `../` entry.
    const evilSrc = join(dir, 'evilsrc');
    await mkdir(evilSrc, { recursive: true });
    await writeFile(join(evilSrc, 'pwn'), 'x', 'utf-8');
    const evilTar = join(dir, 'evil.tar.gz');
    await tarCreate({ gzip: true, file: evilTar, cwd: evilSrc }, ['pwn']);
    // The single entry 'pwn' is not an allowed top-level → rejected.
    await expect(assertArchiveSafe(evilTar)).rejects.toMatchObject({ code: 'schema_violation' });
  });

  it('rejects an archive containing a symlink entry (C-1 linkpath escape)', async () => {
    const { symlink } = await import('node:fs/promises');
    const src = join(dir, 'linksrc');
    await mkdir(join(src, 'boards'), { recursive: true });
    // boards/evil -> ../../../../tmp/escape
    await symlink('../../../../tmp/escape', join(src, 'boards', 'evil'));
    const linkTar = join(dir, 'link.tar.gz');
    await tarCreate({ gzip: true, file: linkTar, cwd: src }, ['boards']);
    await expect(assertArchiveSafe(linkTar)).rejects.toMatchObject({ code: 'schema_violation' });
  });

  it('import is a clean replace: a board absent from the archive does not survive (C-2)', async () => {
    const out = join(dir, 'backup.tar.gz');
    await createSubstrateArchive(root, out);
    // Add an extra board AFTER the backup was taken.
    await writeFile(paths(root).boardJson('extra'), '{"id":"extra"}', 'utf-8');
    expect(existsSync(paths(root).boardJson('extra'))).toBe(true);
    // Restore over the same root → the extra board must be gone.
    await extractSubstrateArchive(out, root);
    expect(existsSync(paths(root).boardJson('extra'))).toBe(false);
    expect(existsSync(paths(root).boardJson('b1'))).toBe(true);
  });
});
