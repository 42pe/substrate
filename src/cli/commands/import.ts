import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { substrateRootFromCwd, paths } from '../../shared/paths.js';
import { extractSubstrateArchive } from '../archive.js';
import { isProcessAlive } from '../../shared/process.js';
import { SubstrateError } from '../../core/errors.js';

/**
 * `substrate import <path> [--force]` — restore a substrate archive into
 * `.substrate/`. Refuses to overwrite an existing project (a `config.json`)
 * unless `--force`, and refuses if a live `serve` holds the PID file (importing
 * over a live DB would corrupt it). The archive is zip-slip-validated before
 * extraction.
 */
export async function importCommand(
  cwd: string,
  archiveArg: string | undefined,
  force: boolean,
): Promise<void> {
  if (!archiveArg) {
    throw SubstrateError.schemaViolation('Usage: substrate import <archive.tar.gz> [--force]');
  }
  const archivePath = resolve(cwd, archiveArg);
  if (!existsSync(archivePath)) {
    throw SubstrateError.notFound(`Archive not found: ${archivePath}`, { archive: archivePath });
  }

  const root = substrateRootFromCwd(cwd);
  const p = paths(root);

  // Refuse if a live server owns this directory (importing over a live DB).
  if (existsSync(p.pid)) {
    const pid = parseInt((await readFile(p.pid, 'utf-8')).trim(), 10);
    if (!Number.isNaN(pid) && isProcessAlive(pid)) {
      throw SubstrateError.conflict(
        `Substrate is running here (pid ${pid}). Stop it before importing.`,
        { pid },
      );
    }
  }

  if (existsSync(p.config) && !force) {
    throw SubstrateError.conflict(
      `A project already exists at ${root}. Re-run with --force to overwrite it.`,
      { root },
    );
  }

  await extractSubstrateArchive(archivePath, root);
  process.stdout.write(`Imported ${archivePath} into ${root}\n`);
}
