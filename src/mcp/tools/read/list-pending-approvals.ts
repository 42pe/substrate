import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { wrapToolHandler } from '../../wrapper.js';
import {
  listPendingApprovals,
  type PendingApprovalsResult,
} from '../../../operations/list-pending-approvals.js';
import type { ToolDeps } from '../../deps.js';

/**
 * MCP tool: list_pending_approvals — every task across the project (or one board)
 * whose progress is blocked on a HUMAN decision: an active transition_guard whose
 * `require` references a `human_only` field (B3) that's currently unset. This is
 * the machine-readable feed behind `/substrate pending-approval` — an agent that
 * hits a human gate can surface exactly what the human must set to unblock it.
 */

export const listPendingApprovalsShape = {
  board_id: z
    .string()
    .min(1)
    .optional()
    .describe('Limit to one board; omit to scan every board in the project.'),
};
const listPendingApprovalsSchema = z.object(listPendingApprovalsShape);
export type ListPendingApprovalsInput = z.output<typeof listPendingApprovalsSchema>;

export function listPendingApprovalsHandler(
  input: ListPendingApprovalsInput,
  deps: ToolDeps,
): Promise<PendingApprovalsResult> {
  return listPendingApprovals(deps, input.board_id);
}

export function registerListPendingApprovals(server: McpServer, deps: ToolDeps): void {
  server.tool(
    'list_pending_approvals',
    'List every task awaiting a HUMAN approval — its move is gated by a transition_guard requiring a human_only field that is not yet set. Returns { project_name, count, items[] } where each item has board, task, current group, the gate (policy + target group), and awaiting_fields (exactly what a human must set). Optional board_id filter. Use this to report what is blocked on the human (e.g. a /substrate pending-approval flow); agent-set gates and already-approved tasks are excluded.',
    listPendingApprovalsShape,
    wrapToolHandler('list_pending_approvals', listPendingApprovalsSchema, (input) =>
      listPendingApprovalsHandler(input, deps),
    ),
  );
}
