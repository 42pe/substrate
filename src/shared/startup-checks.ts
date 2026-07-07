import { readdirSync } from 'node:fs';
import { paths } from './paths.js';
import { logger } from './logger.js';

/**
 * B7 (dogfood 2026-07-07): a git worktree (or fresh clone) of a project that uses
 * Substrate checks out the COMMITTED board files but NOT the gitignored
 * `data.sqlite`; libsql then creates a fresh EMPTY database on open, so an agent
 * in that worktree silently operates on an empty task board it does NOT share
 * with the main checkout — a sharp "board diverges from reality" footgun.
 *
 * When the server opens a `.substrate/` that already has boards but whose
 * `data.sqlite` did not exist (was just created empty), warn loudly. A genuine
 * first `init` has no committed boards yet, so it does not trip this.
 *
 * NOTE: the cause-aware "broken explicit pointer → error, did you move this
 * project?" case (ERROR, don't create) arrives with the pointer/registry work —
 * see .agents/shared-db-architecture-20260707.md §Phase B. This ships only the
 * fresh-worktree WARN, which degrades gracefully until then.
 */
export function warnIfFreshDbWithBoards(root: string, dbExistedBeforeOpen: boolean): void {
  if (dbExistedBeforeOpen) return; // normal: an existing database
  const p = paths(root);
  let hasBoards = false;
  try {
    hasBoards = readdirSync(p.boardsDir).some((f) => f.endsWith('.json'));
  } catch {
    hasBoards = false; // no boards dir → a genuine first init, not a worktree
  }
  if (!hasBoards) return;
  logger.warn(
    `This .substrate/ has boards but no task database — a fresh EMPTY one was just created at ` +
      `${p.dataSqlite}. If this is a git worktree or fresh clone, its task state is NOT shared ` +
      `with your main checkout (data.sqlite is gitignored, so it doesn't travel with a worktree). ` +
      `To share the board, run substrate with its working directory pointed at the main checkout's ` +
      `.substrate/ (see docs on multi-worktree usage).`,
    { root, data_sqlite: p.dataSqlite },
  );
}
