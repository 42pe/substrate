import { readFile, readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import type { Board, Member, Substrate } from '../core/types.js';
import { readConfig } from '../shared/config.js';
import { paths } from '../shared/paths.js';
import { BoardSchema, MemberSchema } from './schemas.js';
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
 *
 * The MEMBER registry (`members/*.json`) loads LENIENTLY — the opposite of the
 * strict board path. The whole member layer is optional and additive, so a
 * missing `members/` directory ⇒ `[]`, and a malformed member file is warned +
 * skipped (appended to `substrate.warnings`) rather than failing the load.
 * Cross-file member/team integrity is likewise advisory (validator.ts). The one
 * strict exception — Substrate's OWN shipped default members — lives in
 * `loadTemplateMembers`, not here.
 */
export async function loadSubstrate(root: string): Promise<Substrate> {
  const config = await readConfig(root);
  const boardsDir = paths(root).boardsDir;
  const warnings: string[] = [];

  let entries: string[];
  try {
    entries = await readdir(boardsDir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      // No boards yet, but a members/ dir may still exist (unusual, but load it
      // leniently so integrity checks and the read surface stay consistent).
      const members = await loadMembers(root, warnings);
      const substrate: Substrate = { config, boards: [], members, warnings };
      validateSubstrate(substrate);
      return substrate;
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

  // Members are loaded BEFORE validation so the integrity pass (validator.ts)
  // can resolve `team[].member` references against the registry.
  const members = await loadMembers(root, warnings);

  const substrate: Substrate = { config, boards, members, warnings };
  validateSubstrate(substrate);
  return substrate;
}

/**
 * Load the project-level member registry from `<root>/members/*.json`,
 * LENIENTLY. Missing directory ⇒ `[]`. A member file that fails `JSON.parse`,
 * fails `MemberSchema`, or whose filename ≠ its `id` is SKIPPED with a warning
 * appended to `warnings` — it never throws `corruptBoardError` and never aborts
 * the load. One bad member file cannot break a project mostly using prose.
 *
 * Exported so the write path (update_board) can read the registry id set to run
 * the same advisory integrity check the load path does.
 */
export async function loadMembers(root: string, warnings: string[]): Promise<Member[]> {
  const membersDir = paths(root).membersDir;

  let entries: string[];
  try {
    entries = await readdir(membersDir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }

  const files = entries.filter((name) => name.endsWith('.json')).sort();
  const members: Member[] = [];
  for (const filename of files) {
    const filePath = join(membersDir, filename);
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf-8');
    } catch (e) {
      warnings.push(`members/${filename}: could not be read (${(e as Error).message}) — skipped.`);
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      warnings.push(`members/${filename}: not valid JSON (${(e as Error).message}) — skipped.`);
      continue;
    }

    const result = MemberSchema.safeParse(parsed);
    if (!result.success) {
      warnings.push(`members/${filename}: does not match the member schema — skipped.`);
      continue;
    }
    const member = result.data as Member;

    // The filename is the stable key: `<id>.json`. A mismatch means a rename or
    // a copy-paste slip; skip it rather than silently loading a shadow id.
    const expected = basename(filename, '.json');
    if (member.id !== expected) {
      warnings.push(
        `members/${filename}: filename does not match member id '${member.id}' — skipped.`,
      );
      continue;
    }
    members.push(member);
  }
  return members;
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
