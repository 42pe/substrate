import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { substrateRootFromCwd } from '../../shared/paths.js';
import { loadSubstrate } from '../../substrate/loader.js';
import { renderSubstrateHtml } from '../../explain/render.js';
import { SubstrateError } from '../../core/errors.js';

const DEFAULT_OUT = 'substrate-explain.html';

/**
 * `substrate explain [--out <file>]` — write a self-contained HTML map of the
 * substrate: per board an inline-SVG flow diagram + field/policy tables. Reads
 * substrate-as-code only (`loadSubstrate`); never opens `data.sqlite`, so it
 * works even when the DB is absent.
 */
export async function explainCommand(cwd: string, opts: { out?: string } = {}): Promise<void> {
  const root = substrateRootFromCwd(cwd);
  if (!existsSync(root)) {
    throw SubstrateError.notFound(`No .substrate/ in ${cwd}. Run 'substrate init' first.`, { cwd });
  }

  const substrate = await loadSubstrate(root);
  const html = renderSubstrateHtml(substrate);

  const outPath = resolve(cwd, opts.out ?? DEFAULT_OUT);
  await writeFile(outPath, html, 'utf-8');

  process.stdout.write(
    `Wrote substrate explanation to ${outPath} (${substrate.boards.length} board(s)).\n` +
      `Open it in a browser to view the flow diagrams.\n`,
  );
}
