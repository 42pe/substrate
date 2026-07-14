import { existsSync } from 'node:fs';
import { substrateRootFromCwd, paths } from '../../shared/paths.js';
import { configureFileSink } from '../../shared/logger.js';
import { openDatabaseAndMigrate } from '../../storage/client.js';
import { loadSubstrate } from '../../substrate/loader.js';
import {
  listPendingApprovals,
  type PendingApprovalItem,
  type PendingApprovalsResult,
} from '../../operations/list-pending-approvals.js';
import { SubstrateError } from '../../core/errors.js';
import { bold, cyan, yellow, colorEnabled } from '../color.js';
import { truncate, padEnd, visibleWidth, flexWidth } from '../table.js';

/**
 * `substrate pending-approval` — the human's cross-board report of every task
 * waiting on THEM: an autonomous agent hit a `transition_guard` requiring a
 * `human_only` field (B3) it can't set, so the task sits until the human runs
 * `substrate approve`. Renders an aligned, board-grouped table with the exact
 * command to unblock each; `--json` emits the structured aggregate instead.
 * Shares the `listPendingApprovals` aggregate with the MCP tool + HTTP route, so
 * the CLI and the UI never disagree on what's pending.
 */

const INDENT = '  ';
const GAP = '  ';
const ID_LEN = 8;
/** Never shrink the title below this before the row is just allowed to overflow. */
const TITLE_FLOOR = 24;
/** Terminal width to assume when `process.stdout.columns` is unknown (piped). */
const DEFAULT_COLUMNS = 80;

/** First 8 chars of a task id — enough to disambiguate; `substrate approve` takes it too. */
function shortId(id: string): string {
  return id.length <= ID_LEN ? id : id.slice(0, ID_LEN);
}

/** One rendered line: the shared task cells, plus the one approve command it carries. */
interface Row {
  title: string;
  id: string;
  move: string;
  awaiting: string;
  approve: string;
}

/** Explode an item into rows — the primary row plus one extra per additional awaiting field. */
function rowsFor(it: PendingApprovalItem): Row[] {
  const fields = it.awaiting_fields;
  const move = `${it.group_id} → ${it.gate.to_group}`;
  const awaiting = fields.join(', ');
  const cmd = (field: string): string => `substrate approve ${it.task_id} ${field}`;
  // Primary row carries the shared cells; the first field's command lives here.
  const rows: Row[] = [
    {
      title: it.task_title,
      id: shortId(it.task_id),
      move,
      awaiting,
      approve: cmd(fields[0] ?? ''),
    },
  ];
  // One approve line per remaining field (the copy-paste guarantee) on continuation
  // rows whose shared cells are blank so the table stays aligned.
  for (const field of fields.slice(1)) {
    rows.push({ title: '', id: '', move: '', awaiting: '', approve: cmd(field) });
  }
  return rows;
}

/**
 * Pure renderer: `PendingApprovalsResult` → the printable block. Kept pure (no
 * stdout / TTY) so the table + color logic is unit-testable. Widths and
 * truncation are computed on PLAIN cells; color is applied only after padding,
 * so `stripAnsi(render({color:true}))` reproduces `render({color:false})`
 * byte-for-byte.
 */
export function renderPendingApprovals(
  result: PendingApprovalsResult,
  opts: { color: boolean; columns?: number },
): string {
  const { color } = opts;
  const width = opts.columns ?? DEFAULT_COLUMNS;

  const byBoard = new Map<string, { name: string; rows: Row[] }>();
  for (const item of result.items) {
    const entry = byBoard.get(item.board_id) ?? { name: item.board_name, rows: [] };
    entry.rows.push(...rowsFor(item));
    byBoard.set(item.board_id, entry);
  }
  const allRows = [...byBoard.values()].flatMap((b) => b.rows);

  // Fixed columns take their widest cell (header included). The Approve command
  // is verbatim/runnable, so it is never truncated.
  const moveW = Math.max(visibleWidth('Move'), ...allRows.map((r) => visibleWidth(r.move)));
  const awaitingW = Math.max(
    visibleWidth('Awaiting'),
    ...allRows.map((r) => visibleWidth(r.awaiting)),
  );
  const approveW = Math.max(
    visibleWidth('Approve'),
    ...allRows.map((r) => visibleWidth(r.approve)),
  );

  // The Task column is a flexible title sub-column plus a fixed `  (id)` suffix.
  // Shrink the title first so no title overflows the width (floor TITLE_FLOOR).
  const suffixW = visibleWidth(`  (${'x'.repeat(ID_LEN)})`); // "  (" + id + ")"
  const titleNatural = Math.max(0, ...allRows.map((r) => r.title.length));
  const fixed = INDENT.length + GAP.length * 3 + suffixW + moveW + awaitingW + approveW;
  const titleW = flexWidth(titleNatural, fixed, width, TITLE_FLOOR);
  const taskW = Math.max(visibleWidth('Task'), titleW + suffixW);

  const taskCell = (r: Row): string =>
    r.title === '' && r.id === '' ? '' : `${padEnd(truncate(r.title, titleW), titleW)}  (${r.id})`;

  const lines: string[] = [];
  lines.push(`${result.count} task(s) pending human approval in ${result.project_name}:`);
  lines.push('');

  let first = true;
  for (const board of byBoard.values()) {
    lines.push(bold(board.name, color));
    if (first) {
      // Column header once (widths are global, so later boards align under it).
      lines.push(
        INDENT +
          [
            padEnd('Task', taskW),
            padEnd('Move', moveW),
            padEnd('Awaiting', awaitingW),
            'Approve',
          ].join(GAP),
      );
      first = false;
    }
    for (const r of board.rows) {
      const cells = [
        padEnd(taskCell(r), taskW),
        padEnd(r.move, moveW),
        padEnd(r.awaiting ? yellow(r.awaiting, color) : '', awaitingW),
        cyan(r.approve, color),
      ];
      lines.push(INDENT + cells.join(GAP));
    }
  }

  return lines.join('\n') + '\n';
}

export async function pendingApprovalCommand(
  cwd: string,
  opts: { json?: boolean } = {},
): Promise<void> {
  const root = substrateRootFromCwd(cwd);
  if (!existsSync(root)) {
    throw SubstrateError.notFound(`No .substrate/ in ${cwd}. Run 'substrate init' first.`, { cwd });
  }
  const p = paths(root);
  configureFileSink(p.logFile);
  const client = await openDatabaseAndMigrate(p.dataSqlite);
  try {
    const result = await listPendingApprovals({ client, loadSubstrate: () => loadSubstrate(root) });

    if (opts.json) {
      // Machine surface: the structured aggregate at parity with the MCP tool.
      // Never colorized, honored even on a TTY, valid for the empty case too.
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      return;
    }

    if (result.count === 0) {
      process.stdout.write(`No tasks pending human approval in ${result.project_name}.\n`);
      return;
    }

    process.stdout.write(
      renderPendingApprovals(result, { color: colorEnabled(), columns: process.stdout.columns }),
    );
  } finally {
    client.close();
  }
}
