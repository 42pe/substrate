import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { wrapToolHandler } from '../../wrapper.js';
import { getTask } from '../../../storage/repositories/tasks.js';
import type { Task } from '../../../core/types.js';
import type { ToolDeps } from '../../deps.js';

/**
 * MCP tool: get_task — fetch one task by id, including its current `version`
 * (which the agent must echo back on `update_task`). `not_found` if missing.
 */

export const getTaskShape = {
  id: z.string().min(1, 'id is required'),
};
const getTaskSchema = z.object(getTaskShape);
export type GetTaskInput = z.output<typeof getTaskSchema>;

export function getTaskToolHandler(input: GetTaskInput, deps: ToolDeps): Promise<Task> {
  return getTask(deps.client, input.id);
}

export function registerGetTask(server: McpServer, deps: ToolDeps): void {
  server.tool(
    'get_task',
    'Fetch one task by id, including its current `version` (which you must echo back on `update_task`).',
    getTaskShape,
    wrapToolHandler('get_task', getTaskSchema, (input) => getTaskToolHandler(input, deps)),
  );
}
