import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { wrapToolHandler } from '../../wrapper.js';
import { getComment } from '../../../storage/repositories/comments.js';
import type { Comment } from '../../../core/types.js';
import type { ToolDeps } from '../../deps.js';

/** MCP tool: get_comment — fetch one comment by id. `not_found` if missing. */

export const getCommentShape = {
  id: z.string().min(1, 'id is required'),
};
const getCommentSchema = z.object(getCommentShape);
export type GetCommentInput = z.output<typeof getCommentSchema>;

export function getCommentToolHandler(input: GetCommentInput, deps: ToolDeps): Promise<Comment> {
  return getComment(deps.client, input.id);
}

export function registerGetComment(server: McpServer, deps: ToolDeps): void {
  server.tool(
    'get_comment',
    'Fetch one comment by id.',
    getCommentShape,
    wrapToolHandler('get_comment', getCommentSchema, (input) => getCommentToolHandler(input, deps)),
  );
}
