import { existsSync } from 'node:fs';
import { substrateRootFromCwd } from '../../shared/paths.js';
import { loadSubstrate } from '../../substrate/loader.js';
import { SubstrateError } from '../../core/errors.js';
import type { Policy } from '../../core/types.js';

/**
 * `substrate validate` — a server-less lint of the substrate's boards + policies,
 * runnable in CI (dogfood 2026-07-07: "a silently-dead gate is worse than no gate").
 *
 * The heavy validation already runs on LOAD (`validateBoardStructure` parses every
 * policy `definition` and resolves `from_group`/`to_group`), so a substrate that
 * loads has valid, resolvable policies. This command surfaces that check without
 * starting `mcp`/`serve` — a corrupt substrate prints the actionable error + exits
 * non-zero — and adds logical-smell WARNINGS the load doesn't (a guard whose
 * `from_group === to_group` can never fire on a real move). Warnings are advisory
 * (exit 0); only a failed load exits non-zero.
 */
function lintPolicy(p: Policy): string[] {
  const warns: string[] = [];
  if (p.type === 'transition_guard') {
    const from = p.definition['from_group'];
    const to = p.definition['to_group'];
    if (typeof from === 'string' && from === to && from !== '*') {
      warns.push(`from_group === to_group ('${from}') — this guard can never fire on a real move.`);
    }
  }
  return warns;
}

export async function validateCommand(cwd: string): Promise<void> {
  const root = substrateRootFromCwd(cwd);
  if (!existsSync(root)) {
    throw SubstrateError.notFound(`No .substrate/ in ${cwd}. Run 'substrate init' first.`, { cwd });
  }

  let substrate;
  try {
    substrate = await loadSubstrate(root);
  } catch (e) {
    if (SubstrateError.is(e)) {
      // A corrupt/invalid substrate (bad policy definition, dangling group ref, …)
      // fails the load with an actionable error — surface it + exit non-zero.
      process.stderr.write(`✗ Substrate failed to validate: ${e.message}\n`);
      const fix = e.details?.['fix_prompt'];
      if (typeof fix === 'string') process.stderr.write(`\n${fix}\n`);
      process.exitCode = 1;
      return;
    }
    throw e;
  }

  let policies = 0;
  let warnings = 0;
  for (const board of substrate.boards) {
    process.stdout.write(
      `Board ${board.id} (${board.name}): ${board.policies.length} policies, ${board.groups.length} groups\n`,
    );
    for (const p of board.policies) {
      policies += 1;
      for (const w of lintPolicy(p)) {
        warnings += 1;
        process.stdout.write(`  ⚠ ${p.name} (${p.id}): ${w}\n`);
      }
    }
  }

  if (warnings === 0) {
    process.stdout.write(
      `✓ ${substrate.boards.length} board(s), ${policies} policies — loaded; definitions parse + group refs resolve, no warnings.\n`,
    );
  } else {
    process.stdout.write(`\n${warnings} warning(s) (advisory).\n`);
  }
}
