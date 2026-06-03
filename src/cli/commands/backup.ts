import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { substrateRootFromCwd, paths } from '../../shared/paths.js';
import { createSubstrateArchive } from '../archive.js';
import { SubstrateError } from '../../core/errors.js';

/**
 * `substrate backup` — write a timestamped `.tar.gz` of the substrate into
 * `.substrate/backups/`. Prints the path. No retention/pruning in v1.
 */
export async function backupCommand(cwd: string): Promise<void> {
  const root = substrateRootFromCwd(cwd);
  if (!existsSync(root)) {
    throw SubstrateError.notFound(`No .substrate/ in ${cwd}. Run 'substrate init' first.`, { cwd });
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = join(paths(root).root, 'backups', `substrate-${stamp}.tar.gz`);
  await createSubstrateArchive(root, outPath);
  process.stdout.write(`Backup written to ${outPath}\n`);
}
