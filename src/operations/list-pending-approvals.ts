import { SubstrateError } from '../core/errors.js';
import type { ToolDeps } from '../mcp/deps.js';
import { listActiveTasksForBoard } from '../storage/repositories/tasks.js';
import { pendingApprovalFor, type PendingGate } from '../policy/pending-approval.js';

/**
 * Cross-board "pending human approval" aggregate (sprint pending-approval).
 *
 * Shared by every surface — the `list_pending_approvals` MCP tool, the
 * `substrate pending-approval` CLI, and `GET /api/pending-approvals` — so the
 * definition of "pending" lives in exactly one place (`pendingApprovalFor`).
 * Loads the substrate fresh, scans each board's active tasks, and returns the
 * ones whose progress is blocked by an unset `human_only` gate field.
 */

export interface PendingApprovalItem {
  board_id: string;
  board_name: string;
  task_id: string;
  task_title: string;
  group_id: string;
  gate: PendingGate;
  awaiting_fields: string[];
}

export interface PendingApprovalsResult {
  project_name: string;
  count: number;
  items: PendingApprovalItem[];
}

export async function listPendingApprovals(
  deps: Pick<ToolDeps, 'client' | 'loadSubstrate'>,
  boardId?: string,
): Promise<PendingApprovalsResult> {
  const substrate = await deps.loadSubstrate();

  let boards = substrate.boards.filter((b) => b.archived_at === null);
  if (boardId !== undefined) {
    const target = substrate.boards.find((b) => b.id === boardId);
    if (!target) {
      throw SubstrateError.notFound(
        `Board '${boardId}' not found. Use list_boards to see what's available.`,
        { entity: 'board', id: boardId },
      );
    }
    boards = [target];
  }

  const items: PendingApprovalItem[] = [];
  for (const board of boards) {
    const tasks = await listActiveTasksForBoard(deps.client, board.id);
    for (const task of tasks) {
      const approval = pendingApprovalFor(board, task);
      if (approval.pending && approval.gate) {
        items.push({
          board_id: board.id,
          board_name: board.name,
          task_id: task.id,
          task_title: task.title,
          group_id: task.group_id,
          gate: approval.gate,
          awaiting_fields: approval.awaiting_fields,
        });
      }
    }
  }

  return { project_name: substrate.config.project_name, count: items.length, items };
}
