import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { Board, Substrate } from '../../core/types.js';
import { SubstrateError } from '../../core/errors.js';
import { BoardSchema } from '../../substrate/schemas.js';
import { validateSubstrate } from '../../substrate/validator.js';
import { TemplateManifestSchema, type TemplateManifest } from './manifest.js';

/**
 * Network-free, fs-only resolver for an EXTERNAL shared substrate template
 * (Phase 8). The agent clones a repo (it has `git`); this loader takes a LOCAL
 * filesystem path only and never imports git/HTTP. It returns the template's
 * boards (verbatim — no field mutation) plus how they were found.
 *
 * Resolution precedence (deterministic, spec §3.3):
 *   1. URL-shaped arg → reject (clone first).
 *   2. path doesn't exist → not_found.
 *   3. a FILE arg must be named `substrate-template.json` → else "that's a board
 *      file, not a template" (O3). Filename-only check; contents not sniffed.
 *   4. a DIRECTORY → manifest at root if present, else convention probe
 *      (`.substrate/boards/` then `boards/`, first existing-and-non-empty wins).
 */

export interface ResolvedTemplate {
  manifest: TemplateManifest | null;
  source: 'manifest' | 'convention';
  boards: Board[];
}

const MANIFEST_NAME = 'substrate-template.json';
const URL_RE = /^[a-z][a-z0-9+.-]*:\/\/|^git@/i;

export async function loadExternalTemplate(path: string): Promise<ResolvedTemplate> {
  if (URL_RE.test(path)) {
    throw SubstrateError.schemaViolation(
      'Substrate does not fetch over the network. Have your agent clone the repo, ' +
        'then run `substrate add <local-clone-dir>`.',
      { path },
    );
  }

  let st;
  try {
    st = await stat(path);
  } catch {
    throw SubstrateError.notFound(`No such path: ${path}`, { path });
  }

  if (st.isFile()) {
    // A file arg is only valid if it IS the manifest (its dir is the root).
    if (basename(path) !== MANIFEST_NAME) {
      throw SubstrateError.schemaViolation(
        `'${path}' is a board file, not a template; point at the template directory or its ${MANIFEST_NAME}.`,
        { path },
      );
    }
    const rootReal = await realpath(dirname(path));
    return loadManifestMode(path, rootReal);
  }

  if (!st.isDirectory()) {
    throw SubstrateError.notFound(`No such path: ${path}`, { path });
  }

  const rootReal = await realpath(path);
  const manifestPath = join(path, MANIFEST_NAME);
  if (existsSync(manifestPath)) {
    return loadManifestMode(manifestPath, rootReal);
  }
  return loadConventionMode(path, rootReal);
}

// --- manifest mode ---------------------------------------------------------

async function loadManifestMode(manifestPath: string, rootReal: string): Promise<ResolvedTemplate> {
  const raw = await readFile(manifestPath, 'utf-8');
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw SubstrateError.schemaViolation(
      `Invalid JSON in ${MANIFEST_NAME} (${manifestPath}): ${(e as Error).message}`,
      { path: manifestPath },
    );
  }
  const parsed = TemplateManifestSchema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const at = first?.path.length ? ` at '${first.path.join('.')}'` : '';
    throw SubstrateError.schemaViolation(
      `Invalid ${MANIFEST_NAME} (${manifestPath})${at}: ${first?.message ?? 'schema error'}.`,
      { issues: parsed.error.issues },
    );
  }
  const manifest = parsed.data;

  const items: BoardSource[] = [];
  for (const rel of manifest.boards) {
    if (isAbsolute(rel) || rel.startsWith('~')) {
      throw SubstrateError.schemaViolation(
        `Manifest board path '${rel}' must be a relative path inside the template (no absolute paths or '~').`,
        { path: rel },
      );
    }
    const abs = resolve(rootReal, rel);
    assertInside(rootReal, abs, rel);
    if (!existsSync(abs)) {
      throw SubstrateError.notFound(`Manifest lists '${rel}' but ${abs} does not exist.`, {
        path: rel,
      });
    }
    const real = await realpath(abs);
    assertInside(rootReal, real, rel); // re-check after symlink resolution
    items.push(parseBoardFile(real, await readFile(real, 'utf-8')));
  }

  const boards = finalizeBoards(items);
  return { manifest, source: 'manifest', boards };
}

// --- convention mode -------------------------------------------------------

async function loadConventionMode(dir: string, rootReal: string): Promise<ResolvedTemplate> {
  // Probe in fixed order; the FIRST that exists and has ≥1 *.json wins. No union.
  const probes = [join(dir, '.substrate', 'boards'), join(dir, 'boards')];
  for (const probe of probes) {
    if (!existsSync(probe)) continue;
    const files = (await readdir(probe)).filter((f) => f.endsWith('.json')).sort();
    if (files.length === 0) continue;

    const items: BoardSource[] = [];
    for (const f of files) {
      const abs = join(probe, f);
      const real = await realpath(abs);
      assertInside(rootReal, real, f);
      items.push(parseBoardFile(real, await readFile(real, 'utf-8')));
    }
    const boards = finalizeBoards(items);
    return { manifest: null, source: 'convention', boards };
  }

  throw SubstrateError.notFound(
    `No ${MANIFEST_NAME} and no boards under .substrate/boards/ or boards/ at ${dir}. ` +
      'Is this a substrate template?',
    { path: dir },
  );
}

// --- shared helpers --------------------------------------------------------

interface BoardSource {
  file: string;
  board: Board;
}

function parseBoardFile(file: string, raw: string): BoardSource {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw SubstrateError.schemaViolation(
      `Invalid JSON in board file ${file}: ${(e as Error).message}`,
      {
        path: file,
      },
    );
  }
  const parsed = BoardSchema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const at = first?.path.length ? ` at '${first.path.join('.')}'` : '';
    throw SubstrateError.schemaViolation(
      `Board file ${file} failed validation${at}: ${first?.message ?? 'schema error'}.`,
      { issues: parsed.error.issues },
    );
  }
  // `as Board`: the Zod output widens optionals; the existing loader/template
  // loader use the same cast (exactOptionalPropertyTypes vs the hand-written type).
  return { file, board: parsed.data as Board };
}

/**
 * Cross-file duplicate-id detection (C3 — name BOTH files), then the bundle
 * integrity check via the existing `validateSubstrate` (board-LOCAL except
 * board-id uniqueness; catches an `enum` field missing `values`, a
 * `transition_guard` whose from/to is a non-existent group within its own
 * board, etc.). The synthetic `Substrate` is type-level only — `validateSubstrate`
 * reads `.boards` exclusively and never `ConfigSchema.parse`s `.config`.
 */
function finalizeBoards(items: BoardSource[]): Board[] {
  const seen = new Map<string, string>();
  for (const { file, board } of items) {
    const prev = seen.get(board.id);
    if (prev !== undefined) {
      throw SubstrateError.schemaViolation(
        `Duplicate board id '${board.id}' in ${prev} and ${file}.`,
        { id: board.id },
      );
    }
    seen.set(board.id, file);
  }
  const boards = items.map((i) => i.board);
  validateSubstrate({ boards } as unknown as Substrate);
  return boards;
}

function assertInside(rootReal: string, candidate: string, label: string): void {
  const rel = relative(rootReal, candidate);
  const inside = rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
  if (!inside) {
    throw SubstrateError.schemaViolation(
      `Template path '${label}' escapes the template directory.`,
      { path: label },
    );
  }
}
