import { existsSync } from 'node:fs';
import { substrateRootFromCwd, paths } from '../../shared/paths.js';
import { configureFileSink } from '../../shared/logger.js';
import { openDatabaseAndMigrate } from '../../storage/client.js';
import { loadSubstrate } from '../../substrate/loader.js';
import {
  listPendingApprovals,
  type PendingApprovalItem,
} from '../../operations/list-pending-approvals.js';
import { SubstrateError } from '../../core/errors.js';

/**
 * `substrate pending-approval` — the human's cross-board report of every task
 * waiting on THEM: an autonomous agent hit a `transition_guard` requiring a
 * `human_only` field (B3) it can't set, so the task sits until the human runs
 * `substrate approve`. Prints them grouped by board with the exact command to
 * unblock each. Shares the `listPendingApprovals` aggregate with the MCP tool +
 * HTTP route, so the CLI and the UI never disagree on what's pending.
 */
export async function pendingApprovalCommand(cwd: string): Promise<void> {
  const root = substrateRootFromCwd(cwd);
  if (!existsSync(root)) {
    throw SubstrateError.notFound(`No .substrate/ in ${cwd}. Run 'substrate init' first.`, { cwd });
  }
  const p = paths(root);
  configureFileSink(p.logFile);
  const client = await openDatabaseAndMigrate(p.dataSqlite);
  try {
    const result = await listPendingApprovals({ client, loadSubstrate: () => loadSubstrate(root) });

    if (result.count === 0) {
      process.stdout.write(`No tasks pending human approval in ${result.project_name}.\n`);
      return;
    }

    process.stdout.write(
      `${result.count} task(s) pending human approval in ${result.project_name}:\n\n`,
    );

    const byBoard = new Map<string, PendingApprovalItem[]>();
    for (const item of result.items) {
      const arr = byBoard.get(item.board_id) ?? [];
      arr.push(item);
      byBoard.set(item.board_id, arr);
    }

    for (const items of byBoard.values()) {
      process.stdout.write(`  ${items[0]!.board_name}\n`);
      for (const it of items) {
        const fields = it.awaiting_fields.join(', ');
        process.stdout.write(
          `    • ${it.task_title} (${it.task_id})\n` +
            `      waiting on you to set ${fields} to move ${it.group_id} → ${it.gate.to_group}\n` +
            `      run: substrate approve ${it.task_id} ${it.awaiting_fields[0]}\n`,
        );
      }
      process.stdout.write('\n');
    }
  } finally {
    client.close();
  }
}
