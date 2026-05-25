import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SubstrateError } from '../../../core/errors.js';
import {
  successEnvelope,
  errorEnvelope,
  type SuccessEnvelope,
  type ErrorEnvelope,
} from '../../../core/envelope.js';
import type { Task } from '../../../core/types.js';
import { createTask } from '../../../storage/repositories/tasks.js';
import type { ToolDeps } from '../../deps.js';

/**
 * MCP tool: create_task — Phase 1 minimal.
 *
 * No policy enforcement, no `field_schema` validation against board substrate
 * (boards don't exist yet in Phase 1). Just inserts a row into the tasks
 * table after Zod input validation.
 *
 * In Phase 2: gain `field_schema` validation. In Phase 3: gain policy
 * engine integration (transition_guards run on group_id changes;
 * agent_responsibility hints accumulate into `policies_fired`).
 */

/**
 * Zod raw shape for `create_task` input. Exported as the *shape* (the object
 * literal whose values are Zod types) for `McpServer.tool()` registration,
 * which wraps it into a ZodObject internally for `tools/list` schema
 * generation. The wrapped object is also exported as `createTaskSchema` for
 * unit tests and direct handler invocation.
 */
export const createTaskShape = {
  board_id: z.string().min(1, 'board_id is required'),
  group_id: z.string().min(1, 'group_id is required'),
  parent_id: z.string().min(1).optional(),
  title: z.string().min(1, 'title is required'),
  description: z.string().optional(),
  custom_data: z.record(z.string(), z.unknown()).optional(),
  agent_name: z.string().min(1, 'agent_name is required'),
};

export const createTaskSchema = z.object(createTaskShape);

export type CreateTaskInput = z.output<typeof createTaskSchema>;

/**
 * Pure handler: validate, build task, insert, return envelope.
 *
 * Direct call signature used by unit tests. The MCP-protocol wrapper sits
 * on top via `registerCreateTask`.
 */
export async function createTaskHandler(
  input: CreateTaskInput,
  deps: ToolDeps,
): Promise<SuccessEnvelope<Task> | ErrorEnvelope> {
  const now = new Date().toISOString();
  const task: Task = {
    id: randomUUID(),
    board_id: input.board_id,
    group_id: input.group_id,
    parent_id: input.parent_id ?? null,
    origin_task_id: null,
    title: input.title,
    description: input.description ?? '',
    custom_data: input.custom_data ?? {},
    version: 1,
    created_by_agent: input.agent_name,
    created_at: now,
    updated_at: now,
    archived_at: null,
  };

  try {
    await createTask(deps.client, task);
  } catch (e) {
    if (SubstrateError.is(e)) return errorEnvelope(e);
    return errorEnvelope(
      SubstrateError.internalError(`Failed to create task: ${(e as Error).message}`),
    );
  }

  return successEnvelope<Task>({
    entity: 'task',
    id: task.id,
    version: task.version,
    state: task,
  });
}

/**
 * Register the tool onto an `McpServer` instance. Wraps the pure handler
 * in the MCP CallToolResult contract: serializes the envelope as JSON in a
 * single text content block; sets `isError` based on envelope shape.
 */
export function registerCreateTask(server: McpServer, deps: ToolDeps): void {
  server.tool(
    'create_task',
    'Create a new task on a board. Returns the task as written, with an empty policies_fired array in Phase 1 (no policy engine yet).',
    createTaskShape,
    async (input) => {
      const envelope = await createTaskHandler(input, deps);
      return {
        content: [{ type: 'text', text: JSON.stringify(envelope) }],
        isError: !envelope.ok,
      };
    },
  );
}
