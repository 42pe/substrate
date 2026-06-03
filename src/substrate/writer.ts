import { readFile, rename, open, unlink } from 'node:fs/promises';
import { basename } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Board, Config, Substrate } from '../core/types.js';
import { SubstrateError } from '../core/errors.js';
import { paths } from '../shared/paths.js';
import { readConfig } from '../shared/config.js';
import { BoardSchema } from './schemas.js';

/**
 * A board id becomes a filename (`boards/<id>.json`). Reject anything that
 * isn't a single safe path component BEFORE it reaches the filesystem — a
 * caller-supplied id like `../../evil` would otherwise escape `boards/` (B1).
 * Throw `not_found` rather than confirming the traversal attempt.
 */
function assertSafeBoardId(id: string): void {
  if (
    id.length === 0 ||
    id !== basename(id) ||
    id.includes('/') ||
    id.includes('\\') ||
    id.includes('..')
  ) {
    throw SubstrateError.notFound(`Board '${id}' not found.`, { entity: 'board', id });
  }
}

/**
 * Atomic substrate-file writer (Phase 4).
 *
 * The board file is the atomic write unit; version CAS is per-entity (board /
 * group / policy each carry a `version`). The locked write-safety model is
 * atomic-rename + version CAS — NO OS file locking (spec §3.1). Two residuals
 * are accepted for a single-user local tool: a narrow cross-process TOCTOU
 * window between a writer's re-read and its rename, and last-write-wins for
 * create-ops (which carry no version). See spec R-1 / plan R2.
 *
 * `mutate` owns the version semantics (it can't be generic — create-ops carry
 * no version, and different tools bump different entities). The writer owns the
 * atomic mechanics: write to a temp sibling, fsync, rename over the target.
 */

/** Write JSON atomically: temp sibling → fsync → rename. `exclusive` uses O_EXCL on the temp only (the rename still overwrites). */
async function writeJsonAtomic(targetPath: string, value: unknown): Promise<void> {
  const tmpPath = `${targetPath}.tmp-${randomBytes(6).toString('hex')}`;
  const body = `${JSON.stringify(value, null, 2)}\n`;
  const handle = await open(tmpPath, 'wx');
  try {
    await handle.writeFile(body, 'utf-8');
    await handle.sync();
  } catch (e) {
    // C1: a write/sync failure (ENOSPC, EIO…) before rename leaks the temp.
    await handle.close().catch(() => undefined);
    await unlink(tmpPath).catch(() => undefined);
    throw e;
  } finally {
    await handle.close().catch(() => undefined);
  }
  try {
    await rename(tmpPath, targetPath);
  } catch (e) {
    await unlink(tmpPath).catch(() => undefined); // best-effort temp cleanup
    throw e;
  }
}

/** Create a brand-new board file; fails (`conflict`) if one already exists. */
export async function createBoardFile(root: string, board: Board): Promise<void> {
  assertSafeBoardId(board.id);
  const target = paths(root).boardJson(board.id);
  const body = `${JSON.stringify(board, null, 2)}\n`;
  try {
    // `wx` makes this a true create — never clobbers an existing board file.
    const handle = await open(target, 'wx');
    try {
      await handle.writeFile(body, 'utf-8');
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
      throw SubstrateError.conflict(`Board '${board.id}' already exists.`, {
        entity: 'board',
        id: board.id,
      });
    }
    throw e;
  }
}

function parseBoardFile(raw: string, boardId: string): Board {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw SubstrateError.internalError(
      `Malformed boards/${boardId}.json: ${(e as Error).message}`,
      {
        file: `boards/${boardId}.json`,
      },
    );
  }
  const result = BoardSchema.safeParse(parsed);
  if (!result.success) {
    throw SubstrateError.internalError(`Invalid boards/${boardId}.json shape`, {
      file: `boards/${boardId}.json`,
      issues: result.error.issues,
    });
  }
  return result.data as Board;
}

/**
 * Read a board file fresh, apply `mutate` (which version-checks + bumps + may
 * throw), and atomically write the result back. The fresh read happens as late
 * as possible — immediately before the mutate + rename — to minimize the
 * cross-process TOCTOU window. `not_found` if the file is missing.
 *
 * C2: a `mutate` that returns `next` referentially equal to the board it was
 * given (an idempotent no-op) skips the write entirely — no needless fsync/
 * rename, narrower window for a torn write.
 */
export async function mutateBoardFile<T>(
  root: string,
  boardId: string,
  mutate: (board: Board) => { result: T; next: Board },
): Promise<T> {
  assertSafeBoardId(boardId);
  const target = paths(root).boardJson(boardId);
  let raw: string;
  try {
    raw = await readFile(target, 'utf-8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      throw SubstrateError.notFound(`Board '${boardId}' not found.`, {
        entity: 'board',
        id: boardId,
      });
    }
    throw e;
  }
  const board = parseBoardFile(raw, boardId);
  const { result, next } = mutate(board);
  if (next !== board) await writeJsonAtomic(target, next);
  return result;
}

/** Read + atomically rewrite `config.json` via `mutate`. */
export async function mutateConfig<T>(
  root: string,
  mutate: (config: Config) => { result: T; next: Config },
): Promise<T> {
  const config = await readConfig(root);
  const { result, next } = mutate(config);
  await writeJsonAtomic(paths(root).config, next);
  return result;
}

/**
 * Locate the board that holds a given group/policy id (O(boards) scan — a
 * deliberate non-optimization at v1 scale). Returns the board, or null.
 */
export function findBoardHolding(
  substrate: Substrate,
  entityId: string,
  kind: 'group' | 'policy',
): Board | null {
  for (const board of substrate.boards) {
    const list = kind === 'group' ? board.groups : board.policies;
    if (list.some((e) => e.id === entityId)) return board;
  }
  return null;
}
