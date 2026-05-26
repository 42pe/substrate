import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, appendFile, rm } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { paths, substrateRootFromCwd } from '../../shared/paths.js';
import { writeConfig } from '../../shared/config.js';
import { openDatabaseAndMigrate } from '../../storage/client.js';
import { BINARY_SCHEMA_VERSION } from '../../core/version.js';
import { SubstrateError } from '../../core/errors.js';
import type { Config } from '../../core/types.js';

/**
 * Distinctive marker for our gitignore block. Phrased so it's unlikely to
 * appear in normal user comments. Reviewer C-6 fix.
 *
 * The check uses startsWith on a line, not a free-form `.includes()`, so
 * a comment like "# TODO: figure out substrate runtime state" won't trip
 * idempotency.
 */
const GITIGNORE_MARKER = '# substrate:v1:gitignore-block (managed by `substrate init`)';

const GITIGNORE_BLOCK = `
${GITIGNORE_MARKER}
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
 * Refuses if `.substrate/` already exists. On any failure AFTER the initial
 * directory was created, attempts a best-effort rollback by removing the
 * partial `.substrate/` so the user can retry cleanly. Reviewer C-1 fix.
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

  // From here on, any failure should clean up the partial directory.
  try {
    await mkdir(p.boardsDir, { recursive: true });
    await mkdir(p.attachmentsDir, { recursive: true });

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

    // Update .gitignore — create or append. Lives outside the try/rollback
    // window because the .gitignore is user-owned (we don't want to roll
    // back the user's .gitignore on our internal failure).
    // Intentional: gitignore update happens last so any earlier failure
    // doesn't leave gitignore-only changes behind.
    await updateGitignore(cwd);

    return { config, root };
  } catch (err) {
    // Best-effort rollback of our partial .substrate/. Swallow rollback
    // errors — the original failure is the actionable signal.
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }
}

/**
 * Add Substrate's gitignore entries to the project's .gitignore. Creates
 * the file if missing. Idempotent — checks for a marker at the start of
 * a line before appending. Reviewer C-6 fix.
 */
async function updateGitignore(cwd: string): Promise<void> {
  const gitignorePath = join(cwd, '.gitignore');
  if (!existsSync(gitignorePath)) {
    await writeFile(gitignorePath, GITIGNORE_BLOCK.trimStart(), 'utf-8');
    return;
  }
  const existing = await readFile(gitignorePath, 'utf-8');
  // Look for the marker as a standalone line — not a substring inside an
  // unrelated comment. Prevents false-positives like
  // `# TODO: substrate runtime state gitignore`.
  const lines = existing.split('\n');
  if (lines.some((line) => line === GITIGNORE_MARKER)) {
    return; // Already has our block
  }
  await appendFile(gitignorePath, GITIGNORE_BLOCK, 'utf-8');
}
