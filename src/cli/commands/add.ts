import { existsSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Board, Substrate } from '../../core/types.js';
import { SubstrateError } from '../../core/errors.js';
import { substrateRootFromCwd, paths } from '../../shared/paths.js';
import { loadSubstrate } from '../../substrate/loader.js';
import { createBoardFile } from '../../substrate/writer.js';
import { validateSubstrate } from '../../substrate/validator.js';
import { isSafeBoardId } from '../../substrate/board-id.js';
import { loadExternalTemplate, type ResolvedTemplate } from '../templates/external.js';

/**
 * `substrate add <path> [--yes] [--as <id>]` — apply a shared substrate
 * TEMPLATE (boards + their groups/field_schema/policies, never runtime) into an
 * EXISTING `.substrate/`. **Dry-run by default**: with no `--yes` it validates +
 * previews and writes NOTHING; `--yes` applies transactionally. Board-id
 * collisions REFUSE by default; `--as <id>` renames a single-board template.
 *
 * The CLI is network-free — `<path>` is a LOCAL directory (the agent clones
 * first). `addCommand` owns its own stdout (the dispatcher prints nothing).
 */
export async function addCommand(
  cwd: string,
  path: string,
  opts: { yes?: boolean; as?: string },
): Promise<void> {
  const root = substrateRootFromCwd(cwd);

  // 1. Existing substrate must be present AND valid (loadSubstrate runs
  //    validateSubstrate). A latent defect aborts BEFORE the template is
  //    resolved, attributing failure to the EXISTING substrate (B3).
  if (!existsSync(root)) {
    throw SubstrateError.notFound(
      `No .substrate/ in ${cwd}. Run \`substrate init\` first, or use ` +
        `\`substrate init --template <path>\` for a fresh project.`,
      { cwd },
    );
  }
  let existing: Substrate;
  try {
    existing = await loadSubstrate(root);
  } catch (e) {
    throw SubstrateError.conflict(
      `Your existing substrate is invalid and must be fixed before adding a template: ${(e as Error).message}`,
      { entity: 'substrate', id: root },
    );
  }

  // 2. Resolve the template (network-free, fs-only).
  const template = await loadExternalTemplate(path);
  const incoming = template.boards;

  // 3. `--as` (single-board rename only).
  if (opts.as !== undefined) {
    if (incoming.length > 1) {
      throw SubstrateError.schemaViolation(
        `\`--as\` renames a single board, but this template has ${incoming.length} boards ` +
          `(${incoming.map((b) => b.id).join(', ')}). Resolve the collision by removing/renaming ` +
          `the existing board(s) instead.`,
        { count: incoming.length },
      );
    }
    if (!isSafeBoardId(opts.as)) {
      throw SubstrateError.schemaViolation(
        `\`--as\` id '${opts.as}' is not a valid board id: must be a single path component, no '/', '\\', or '..'.`,
        { id: opts.as },
      );
    }
    incoming[0]!.id = opts.as;
  }

  // 4. Collision check against ALL existing board ids (active OR archived — an
  //    archived board still owns its boards/<id>.json and `wx` would EEXIST).
  const existingIds = new Set(existing.boards.map((b) => b.id));
  const collisions = incoming.map((b) => b.id).filter((id) => existingIds.has(id));
  if (collisions.length > 0) {
    throw SubstrateError.conflict(
      `Board id '${collisions[0]}' already exists in this substrate. Substrate will not ` +
        `overwrite or merge boards.\n` +
        `- To apply this template under a different id, re-run with --as <newid> (single-board templates only).\n` +
        `- Or remove/rename the existing board first.`,
      { entity: 'board', id: collisions[0]! },
    );
  }

  // 5. Combined-validity (forward-compat scaffolding; today re-confirms only
  //    board-id uniqueness across the merged set, which step 4 already enforces).
  validateSubstrate({
    config: existing.config,
    boards: [...existing.boards, ...incoming],
  });

  // 6. Branch on --yes.
  if (!opts.yes) {
    process.stdout.write(renderPreview(template, resolve(path)));
    return;
  }
  await applyTransactional(root, incoming);
  process.stdout.write(
    `Applied ${incoming.length} board(s) from ${path} into .substrate/boards/: ` +
      `${incoming.map((b) => b.id).join(', ')}\n`,
  );
}

function renderPreview(template: ResolvedTemplate, absPath: string): string {
  const { manifest, source, boards } = template;
  const lines: string[] = [];
  lines.push(
    `Template: ${manifest?.name ?? '(no manifest — convention)'}  v${manifest?.version ?? 'n/a'}`,
  );
  lines.push(`Source: ${absPath}  (${source})`);
  lines.push(`Author: ${manifest?.author ?? 'unknown'}`);
  lines.push(`Boards to add (${boards.length}):`);
  for (const b of boards) {
    const t = b.policies.filter((p) => p.type === 'transition_guard').length;
    const r = b.policies.filter((p) => p.type === 'agent_responsibility').length;
    lines.push(
      `  - ${b.id}  "${b.name}"  — ${b.groups.length} group(s), ${b.policies.length} policy(ies) ` +
        `(${t} transition_guard, ${r} agent_responsibility)`,
    );
  }
  lines.push('Collisions with existing substrate: none');
  lines.push('Dry run — nothing written. Re-run with --yes to apply.');
  return `${lines.join('\n')}\n`;
}

/**
 * Write all boards, tracking created files in write order. If any write throws
 * (e.g. a genuinely concurrent create racing `createBoardFile`'s `wx`), roll
 * back by unlinking ONLY the files THIS apply created, in REVERSE order,
 * best-effort, then rethrow the original error. Pre-existing boards are never
 * touched. Mirrors `initCommand`'s try/rollback discipline.
 */
async function applyTransactional(root: string, boards: Board[]): Promise<void> {
  const created: string[] = [];
  try {
    for (const board of boards) {
      await createBoardFile(root, board);
      created.push(paths(root).boardJson(board.id));
    }
  } catch (e) {
    for (const file of created.reverse()) {
      await unlink(file).catch(() => undefined);
    }
    throw e;
  }
}
