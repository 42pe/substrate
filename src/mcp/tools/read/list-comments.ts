import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { wrapToolHandler } from '../../wrapper.js';
import { paginationShape, type PaginationOutput } from '../../../core/pagination.js';
import { listComments, type ListCommentsFilters } from '../../../storage/repositories/comments.js';
import type { Comment } from '../../../core/types.js';
import type { ToolDeps } from '../../deps.js';

/**
 * MCP tool: list_comments — a task's active comments, oldest-first.
 *
 * `parent_id` filters the thread: pass `null` for thread-root comments, an id
 * for replies to that comment, or omit for all. Archived comments are hidden.
 */

export const listCommentsShape = {
  task_id: z.string().min(1, 'task_id is required'),
  filters: z
    .object({
      parent_id: z.string().min(1).nullable().optional(),
      since: z.string().optional(),
      until: z.string().optional(),
    })
    .optional(),
  pagination: paginationShape.optional(),
};
const listCommentsSchema = z.object(listCommentsShape);
export type ListCommentsInput = z.output<typeof listCommentsSchema>;

export function listCommentsToolHandler(
  input: ListCommentsInput,
  deps: ToolDeps,
): Promise<{ results: Comment[]; pagination: PaginationOutput }> {
  const filters: ListCommentsFilters = input.filters ?? {};
  return listComments(deps.client, input.task_id, filters, input.pagination);
}

export function registerListComments(server: McpServer, deps: ToolDeps): void {
  server.tool(
    'list_comments',
    'List comments on a task, optionally filtered by `parent_id` (thread) or time window. Paginated.',
    listCommentsShape,
    wrapToolHandler('list_comments', listCommentsSchema, (input) =>
      listCommentsToolHandler(input, deps),
    ),
  );
}
