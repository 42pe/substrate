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
import { appendEvent } from '../../../storage/repositories/events.js';
import { withTransaction } from '../../../storage/client.js';
import { validateFieldSchema } from '../../../substrate/field-validator.js';
import { logger } from '../../../shared/logger.js';
import { wrapToolHandler } from '../../wrapper.js';
import type { ToolDeps } from '../../deps.js';

/**
 * MCP tool: create_task.
 *
 * Validates against the board's substrate before writing: the board and group
 * must exist, and `custom_data` is validated lazily against `field_schema.task`
 * (touched keys only; undeclared keys accepted; required NOT enforced on write).
 * The row insert and the `created` TaskEvent share one transaction so a crash
 * never leaves a task with no audit entry.
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

export async function createTaskHandler(
  input: CreateTaskInput,
  deps: ToolDeps,
): Promise<SuccessEnvelope<Task> | ErrorEnvelope> {
  try {
    const substrate = await deps.loadSubstrate();
    const board = substrate.boards.find((b) => b.id === input.board_id);
    if (!board) {
      throw SubstrateError.notFound(
        `Board '${input.board_id}' not found. Use list_boards to see what's available.`,
        { entity: 'board', id: input.board_id },
      );
    }
    const group = board.groups.find((g) => g.id === input.group_id);
    if (!group) {
      throw SubstrateError.notFound(
        `Group '${input.group_id}' not found in board '${input.board_id}'. Use get_board_substrate to see its groups.`,
        { entity: 'group', id: input.group_id },
      );
    }

    const customData = input.custom_data ?? {};
    validateFieldSchema({
      field_schema: board.field_schema.task,
      merged_custom_data: customData,
      touched_keys: Object.keys(customData),
    });

    const now = new Date().toISOString();
    const task: Task = {
      id: randomUUID(),
      board_id: input.board_id,
      group_id: input.group_id,
      parent_id: input.parent_id ?? null,
      origin_task_id: null,
      title: input.title,
      description: input.description ?? '',
      custom_data: customData,
      version: 1,
      created_by_agent: input.agent_name,
      created_at: now,
      updated_at: now,
      archived_at: null,
    };

    // initial_state records the fields the caller explicitly set (not derived
    // defaults), per spec §3.2.
    const initialState: Partial<Task> = {
      board_id: input.board_id,
      group_id: input.group_id,
      title: input.title,
    };
    if (input.parent_id !== undefined) initialState.parent_id = input.parent_id;
    if (input.description !== undefined) initialState.description = input.description;
    if (input.custom_data !== undefined) initialState.custom_data = input.custom_data;

    await withTransaction(deps.client, async (tx) => {
      await createTask(tx, task);
      await appendEvent(tx, {
        task_id: task.id,
        event_type: 'created',
        changes: { initial_state: initialState },
        actor_agent_name: input.agent_name,
        occurred_at: now,
      });
    });

    return successEnvelope<Task>({
      entity: 'task',
      id: task.id,
      version: task.version,
      state: task,
    });
  } catch (e) {
    if (SubstrateError.is(e)) return errorEnvelope(e);
    logger.error('Unhandled error in create_task handler', {
      error: (e as Error).message,
      agent_name: input.agent_name,
    });
    return errorEnvelope(SubstrateError.internalError('Internal error'));
  }
}

export function registerCreateTask(server: McpServer, deps: ToolDeps): void {
  server.tool(
    'create_task',
    "Create a task on a board. `custom_data` is validated lazily against the board's `field_schema`. Requires `agent_name` for audit.",
    createTaskShape,
    wrapToolHandler('create_task', createTaskSchema, (input) => createTaskHandler(input, deps)),
  );
}
