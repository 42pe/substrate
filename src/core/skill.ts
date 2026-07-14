import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  mkdirSync,
  cpSync,
  statSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { BINARY_VERSION } from './version.js';
import { SubstrateError } from './errors.js';

/**
 * Skill / binary sync.
 *
 * The globally-installed agent skill (`~/.claude/skills/substrate`) and the
 * `substrate` binary drift apart because the copy step is manual. This module
 * gives the binary a canonical, packaged copy of the skill and a version stamp,
 * so `substrate install-skill` can refresh the installed copy idempotently and
 * `diagnose` / `--check` can detect drift.
 *
 * The skill ships INSIDE the package (`skills/` is in package.json `files`), so
 * the refresh has a source of truth even after an npm install — no repo needed.
 */

/** The file written into the installed skill dir recording which BINARY_VERSION produced it. */
export const SKILL_STAMP_FILE = '.version';

/** Home directory, honoring $HOME / $USERPROFILE so it's overridable in tests. */
export function userHome(): string {
  return process.env['HOME'] ?? process.env['USERPROFILE'] ?? homedir();
}

/** Where the skill is installed for the agent runtime: `~/.claude/skills/substrate`. */
export function installedSkillDir(): string {
  return join(userHome(), '.claude', 'skills', 'substrate');
}

/**
 * Resolve the skill source shipped inside this package. Walks up from this
 * module's own location looking for a `skills/substrate/SKILL.md` — which works
 * both in dev (`src/core/skill.ts` → repo root) and when installed (the compiled
 * `dist/server/core/skill.js` → package root, since `skills/` is in `files`).
 * Throws a clear error if the packaged skill can't be found (e.g. a build that
 * didn't ship it) rather than silently resolving to nothing.
 */
export function packagedSkillDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i += 1) {
    const candidate = join(dir, 'skills', 'substrate');
    if (existsSync(join(candidate, 'SKILL.md'))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw SubstrateError.internalError(
    'Could not locate the packaged skill (skills/substrate/SKILL.md) relative to the binary. ' +
      'This build may not ship the skill (check the `files` allowlist in package.json).',
  );
}

/** Read + trim the installed version stamp, or null if absent/unreadable. */
export function readInstalledStamp(targetDir: string = installedSkillDir()): string | null {
  const stampPath = join(targetDir, SKILL_STAMP_FILE);
  if (!existsSync(stampPath)) return null;
  try {
    const raw = readFileSync(stampPath, 'utf-8').trim();
    return raw === '' ? null : raw;
  } catch {
    return null;
  }
}

export type SkillState = 'ok' | 'drift' | 'missing';

export interface SkillComparison {
  /** `ok` = stamped current + content matches; `drift` = present but stamp/content off; `missing` = not installed. */
  readonly state: SkillState;
  /** The installed stamp, or null if unstamped/unreadable (drives advisory-vs-hard in diagnose). */
  readonly installed: string | null;
  /** The version the binary expects (BINARY_VERSION). */
  readonly expected: string;
  /** Human-readable detail for the diagnostic line. */
  readonly reason: string;
}

/** List the regular files in `dir` (top-level; the skill tree is flat). */
function skillFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => {
    try {
      return statSync(join(dir, name)).isFile();
    } catch {
      return false;
    }
  });
}

/** True if every packaged skill file exists in `targetDir` byte-identically. */
function contentMatches(packagedDir: string, targetDir: string): boolean {
  for (const name of skillFiles(packagedDir)) {
    const a = join(packagedDir, name);
    const b = join(targetDir, name);
    if (!existsSync(b)) return false;
    try {
      if (!readFileSync(a).equals(readFileSync(b))) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Compare the installed skill against the packaged one:
 *   - `missing`  — the target dir / SKILL.md is absent (never installed).
 *   - `drift`    — present but the stamp is absent/different OR content differs.
 *   - `ok`       — stamped exactly at BINARY_VERSION and every file matches.
 */
export function compareSkill(
  opts: { targetDir?: string; packagedDir?: string } = {},
): SkillComparison {
  const targetDir = opts.targetDir ?? installedSkillDir();
  const packagedDir = opts.packagedDir ?? packagedSkillDir();
  const expected = BINARY_VERSION;

  if (!existsSync(join(targetDir, 'SKILL.md'))) {
    return { state: 'missing', installed: null, expected, reason: 'not installed' };
  }
  const installed = readInstalledStamp(targetDir);
  if (installed === expected && contentMatches(packagedDir, targetDir)) {
    return { state: 'ok', installed, expected, reason: `in sync (v${expected})` };
  }
  const reason =
    installed === null
      ? 'installed but unstamped'
      : installed !== expected
        ? `stamped v${installed}, binary v${expected}`
        : 'content differs from packaged skill';
  return { state: 'drift', installed, expected, reason };
}

/**
 * Copy the packaged skill into the install target and write the version stamp.
 * Idempotent: when already `ok`, nothing is written. Only ever touches the
 * substrate skill subdir (never deletes unrelated files).
 */
export function syncSkill(opts: { targetDir?: string; packagedDir?: string } = {}): {
  changed: boolean;
  version: string;
  targetDir: string;
} {
  const targetDir = opts.targetDir ?? installedSkillDir();
  const packagedDir = opts.packagedDir ?? packagedSkillDir();
  if (compareSkill({ targetDir, packagedDir }).state === 'ok') {
    return { changed: false, version: BINARY_VERSION, targetDir };
  }
  mkdirSync(targetDir, { recursive: true });
  cpSync(packagedDir, targetDir, { recursive: true });
  writeFileSync(join(targetDir, SKILL_STAMP_FILE), `${BINARY_VERSION}\n`, 'utf-8');
  return { changed: true, version: BINARY_VERSION, targetDir };
}
