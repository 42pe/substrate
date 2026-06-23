import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Board, Substrate } from '../core/types.js';
import { readConfig } from '../shared/config.js';
import { paths } from '../shared/paths.js';
import { BoardSchema } from './schemas.js';
import { validateSubstrate } from './validator.js';
import { corruptBoardError } from './corrupt.js';

/**
 * Load the whole substrate from disk: the project config plus every board in
 * `<root>/boards/*.json`. Called once per MCP tool invocation (the cost is a
 * handful of small file reads; no caching in v1 — substrate-as-code can change
 * out from under a long-lived process, and a fresh read is the simplest correct
 * answer).
 *
 * Strict loading: one malformed or shape-invalid board file fails the entire
 * load with an error pointing at the file. Aligned with `config.ts` — the user
 * wants to know a board is broken, not have it silently vanish.
 *
 * A missing `boards/` directory is NOT an error: a freshly-init'd project has
 * no boards yet, and that's a valid (empty) substrate.
 */
export async function loadSubstrate(root: string): Promise<Substrate> {
  const config = await readConfig(root);
  const boardsDir = paths(root).boardsDir;

  let entries: string[];
  try {
    entries = await readdir(boardsDir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      return { config, boards: [] };
    }
    throw e;
  }

  // Enumerate only — we never follow a caller-supplied path, so there's no
  // traversal surface. Sort for deterministic load order (and error ordering).
  const files = entries.filter((name) => name.endsWith('.json')).sort();

  const boards: Board[] = [];
  for (const filename of files) {
    boards.push(await loadBoardFile(join(boardsDir, filename), filename));
  }

  const substrate: Substrate = { config, boards };
  validateSubstrate(substrate);
  return substrate;
}

async function loadBoardFile(filePath: string, filename: string): Promise<Board> {
  const raw = await readFile(filePath, 'utf-8');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw corruptBoardError({
      file: `boards/${filename}`,
      problem: `it is not valid JSON (${(e as Error).message})`,
    });
  }

  const result = BoardSchema.safeParse(parsed);
  if (!result.success) {
    throw corruptBoardError({
      file: `boards/${filename}`,
      problem: 'it does not match the board schema',
      details: { issues: result.error.issues },
    });
  }
  // Zod's `.optional()` infers `T | undefined`, which `exactOptionalPropertyTypes`
  // treats as distinct from the `T?` in our hand-written interfaces. The validated
  // value is structurally a Board (Zod strips absent optionals); the cast bridges
  // that purely-type-level gap.
  return result.data as Board;
}
