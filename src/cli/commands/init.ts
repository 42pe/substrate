import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, appendFile, rm } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { paths, substrateRootFromCwd } from '../../shared/paths.js';
import { writeConfig } from '../../shared/config.js';
import { openDatabaseAndMigrate } from '../../storage/client.js';
import { BINARY_SCHEMA_VERSION } from '../../core/version.js';
import { SubstrateError } from '../../core/errors.js';
import { createBoardFile, createMemberFile } from '../../substrate/writer.js';
import {
  isTemplateName,
  loadTemplateBoard,
  loadTemplateMembers,
  templateNames,
} from '../templates/index.js';
import { loadExternalTemplate } from '../templates/external.js';
import type { Board, Config, Member } from '../../core/types.js';

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
.substrate/serve.json
.substrate/attachments/
.substrate/logs/
`;

export interface InitResult {
  config: Config;
  root: string;
  /** Ids of the boards written from a `--template` (bare init → `[]`). */
  boardIds: string[];
}

/**
 * `npx substrate init` — initialize a `.substrate/` directory in the
 * current working directory.
 *
 * Refuses if `.substrate/` already exists. On any failure AFTER the initial
 * directory was created, attempts a best-effort rollback by removing the
 * partial `.substrate/` so the user can retry cleanly. Reviewer C-1 fix.
 */
export async function initCommand(
  cwd: string,
  opts: { template?: string } = {},
): Promise<InitResult> {
  const root = substrateRootFromCwd(cwd);

  // Error ordering is LOCKED (Phase 7, EXTENDED Phase 8 O5): resolve + validate
  // the template FIRST — before the `.substrate/` conflict — so `--template
  // ./bogus` fails before `.substrate/` is created and wins over the conflict.
  // Disambiguation (O4): a bundled name resolves bundled; else an existing path
  // is resolved by the (network-free) external loader; else the dual-failure
  // error. Resolution reads ONLY the template dir, never creates `.substrate/`.
  let templateBoards: Board[] | null = null;
  // Default members ship ONLY with a bundled template (validated STRICTLY via
  // loadTemplateMembers). External path templates carry boards only in v1.
  let templateMembers: Member[] | null = null;
  if (opts.template !== undefined) {
    if (isTemplateName(opts.template)) {
      templateBoards = [loadTemplateBoard(opts.template)];
      templateMembers = loadTemplateMembers(opts.template);
    } else if (existsSync(opts.template)) {
      templateBoards = (await loadExternalTemplate(opts.template)).boards;
    } else {
      throw SubstrateError.schemaViolation(
        `Unknown template '${opts.template}': not a bundled template ` +
          `(available: ${templateNames().join(', ')}) and not a readable path.`,
        { template: opts.template, available: templateNames() },
      );
    }
  }

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
      description: '',
      version: 1,
      schema_version: BINARY_SCHEMA_VERSION,
      created_at: new Date().toISOString(),
    };
    await writeConfig(root, config);

    // Initialize data.sqlite (creates file, applies WAL + synchronous, runs
    // migration 001, stamps user_version, re-applies busy_timeout)
    const client = await openDatabaseAndMigrate(p.dataSqlite);
    client.close();

    // Opt-in starter board(s) — the bundled board (Phase 7) OR all boards of a
    // local template (Phase 8). Already resolved + validated above. A write
    // failure here triggers the rollback below (rm of the whole partial dir).
    const boardIds: string[] = [];
    if (templateBoards !== null) {
      for (const board of templateBoards) {
        await createBoardFile(root, board);
        boardIds.push(board.id);
      }
    }

    // Bundled-template default member registry, alongside the board file and
    // inside the same create/rollback window (a partial init still rolls back
    // the whole `.substrate/`). Members are optional scaffolding — only written
    // when the resolved template shipped a validated default registry.
    if (templateMembers !== null && templateMembers.length > 0) {
      await mkdir(p.membersDir, { recursive: true });
      for (const member of templateMembers) {
        await createMemberFile(root, member);
      }
    }

    // Update .gitignore — create or append. Lives outside the try/rollback
    // window because the .gitignore is user-owned (we don't want to roll
    // back the user's .gitignore on our internal failure).
    // Intentional: gitignore update happens last so any earlier failure
    // doesn't leave gitignore-only changes behind.
    await updateGitignore(cwd);

    return { config, root, boardIds };
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
