import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { substrateRootFromCwd } from '../../shared/paths.js';
import { createSubstrateArchive } from '../archive.js';
import { SubstrateError } from '../../core/errors.js';

/**
 * `substrate export <path>` — write a `.tar.gz` of the substrate to an arbitrary
 * path (for moving a project between machines).
 */
export async function exportCommand(cwd: string, outArg: string | undefined): Promise<void> {
  const root = substrateRootFromCwd(cwd);
  if (!existsSync(root)) {
    throw SubstrateError.notFound(`No .substrate/ in ${cwd}. Run 'substrate init' first.`, { cwd });
  }
  if (!outArg) {
    throw SubstrateError.schemaViolation('Usage: substrate export <output-path.tar.gz>');
  }
  const outPath = resolve(cwd, outArg);
  await createSubstrateArchive(root, outPath);
  process.stdout.write(`Exported to ${outPath}\n`);
}
