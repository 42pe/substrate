import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { paths, substrateRootFromCwd } from '../../shared/paths.js';
import { writeConfig } from '../../shared/config.js';
import { openDatabaseAndMigrate } from '../../storage/client.js';
import { BINARY_SCHEMA_VERSION } from '../../core/version.js';
import { SubstrateError } from '../../core/errors.js';
import type { Config } from '../../core/types.js';

const GITIGNORE_MARKER = '# Substrate runtime state';

const GITIGNORE_BLOCK = `
${GITIGNORE_MARKER} (per-machine)
.substrate/data.sqlite
.substrate/data.sqlite-wal
.substrate/data.sqlite-shm
.substrate/substrate.pid
.substrate/attachments/
`;

export interface InitResult {
  config: Config;
  root: string;
}

/**
 * `npx substrate init` — initialize a `.substrate/` directory in the
 * current working directory.
 *
 * Refuses if `.substrate/` already exists (re-init requires manual backup
 * + delete first; we don't overwrite). Creates the directory structure,
 * writes config.json, initializes data.sqlite with migration 001 applied
 * and PRAGMA user_version stamped, and adds Substrate's gitignore entries
 * to the project's .gitignore (creating one if absent).
 *
 * Returns the config + root path so tests / future integrations can inspect.
 */
export async function initCommand(cwd: string): Promise<InitResult> {
  const root = substrateRootFromCwd(cwd);

  if (existsSync(root)) {
    throw SubstrateError.conflict(
      `A .substrate/ directory already exists at ${root}. ` +
        `To re-initialize, back it up and remove it first.`,
      { existing_root: root },
    );
  }

  const p = paths(root);

  // Create the directory tree
  await mkdir(p.boardsDir, { recursive: true });
  await mkdir(p.attachmentsDir, { recursive: true });

  // Write config.json
  const config: Config = {
    project_id: randomUUID(),
    project_name: basename(cwd) || 'unnamed-project',
    schema_version: BINARY_SCHEMA_VERSION,
    created_at: new Date().toISOString(),
  };
  await writeConfig(root, config);

  // Initialize data.sqlite (creates file, applies WAL + synchronous, runs
  // migration 001, stamps user_version, re-applies busy_timeout)
  const client = await openDatabaseAndMigrate(p.dataSqlite);
  client.close();

  // Update .gitignore — create or append
  await updateGitignore(cwd);

  return { config, root };
}

/**
 * Add Substrate's gitignore entries to the project's .gitignore. Creates
 * the file if missing. Idempotent — checks for a marker before appending.
 */
async function updateGitignore(cwd: string): Promise<void> {
  const gitignorePath = join(cwd, '.gitignore');
  if (!existsSync(gitignorePath)) {
    await writeFile(gitignorePath, GITIGNORE_BLOCK.trimStart(), 'utf-8');
    return;
  }
  const existing = await readFile(gitignorePath, 'utf-8');
  if (existing.includes(GITIGNORE_MARKER)) {
    return; // Already has our block
  }
  await appendFile(gitignorePath, GITIGNORE_BLOCK, 'utf-8');
}
