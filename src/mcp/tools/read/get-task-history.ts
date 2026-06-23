import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { wrapToolHandler } from '../../wrapper.js';
import { paginationShape, type PaginationOutput } from '../../../core/pagination.js';
import { listEvents, type ListEventsFilters } from '../../../storage/repositories/events.js';
import type { TaskEvent } from '../../../core/types.js';
import type { ToolDeps } from '../../deps.js';

/**
 * MCP tool: get_task_history — the TaskEvent log for a task, oldest-first.
 *
 * Returns events even for an unknown task_id (an empty page), since events are
 * an append-only feed and "no events" is a valid answer, not an error.
 */

const eventTypeEnum = z.enum([
  'created',
  'updated',
  'archived',
  'unarchived',
  'comment_added',
  'comment_edited',
  'comment_archived',
  'move_blocked',
]);

export const getTaskHistoryShape = {
  task_id: z.string().min(1, 'task_id is required'),
  filters: z
    .object({
      event_types: z.array(eventTypeEnum).optional(),
      since: z.string().optional(),
      until: z.string().optional(),
    })
    .optional(),
  pagination: paginationShape.optional(),
};
const getTaskHistorySchema = z.object(getTaskHistoryShape);
export type GetTaskHistoryInput = z.output<typeof getTaskHistorySchema>;

export function getTaskHistoryHandler(
  input: GetTaskHistoryInput,
  deps: ToolDeps,
): Promise<{ results: TaskEvent[]; pagination: PaginationOutput }> {
  const filters: ListEventsFilters = input.filters ?? {};
  return listEvents(deps.client, input.task_id, filters, input.pagination);
}

export function registerGetTaskHistory(server: McpServer, deps: ToolDeps): void {
  server.tool(
    'get_task_history',
    'Fetch the TaskEvent log for a task (created, updated, archived, comment_added, move_blocked, …) in chronological order. Paginated. `move_blocked` records a transition_guard that rejected a move; `created`/`updated` events carry a `policies_fired` list in `changes` when a policy engaged.',
    getTaskHistoryShape,
    wrapToolHandler('get_task_history', getTaskHistorySchema, (input) =>
      getTaskHistoryHandler(input, deps),
    ),
  );
}
