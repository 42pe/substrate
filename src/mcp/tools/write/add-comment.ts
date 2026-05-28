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
import type { Comment } from '../../../core/types.js';
import { getTask } from '../../../storage/repositories/tasks.js';
import { createComment, getComment } from '../../../storage/repositories/comments.js';
import { appendEvent } from '../../../storage/repositories/events.js';
import { withTransaction } from '../../../storage/client.js';
import { validateFieldSchema } from '../../../substrate/field-validator.js';
import { logger } from '../../../shared/logger.js';
import { wrapToolHandler } from '../../wrapper.js';
import type { ToolDeps } from '../../deps.js';

/**
 * MCP tool: add_comment.
 *
 * Validates the target task exists and is active; an optional `parent_id` makes
 * it a reply, and the parent must exist, belong to the same task, and be active.
 * `custom_data` is validated against `field_schema.comments`. The insert and the
 * `comment_added` event share one transaction.
 */

export const addCommentShape = {
  task_id: z.string().min(1, 'task_id is required'),
  parent_id: z.string().min(1).optional(),
  body: z.string().min(1, 'body is required'),
  custom_data: z.record(z.string(), z.unknown()).optional(),
  agent_name: z.string().min(1, 'agent_name is required'),
};

export const addCommentSchema = z.object(addCommentShape);
export type AddCommentInput = z.output<typeof addCommentSchema>;

export async function addCommentHandler(
  input: AddCommentInput,
  deps: ToolDeps,
): Promise<SuccessEnvelope<Comment> | ErrorEnvelope> {
  try {
    const now = new Date().toISOString();

    const comment = await withTransaction(deps.client, async (tx) => {
      const task = await getTask(tx, input.task_id); // not_found if missing
      if (task.archived_at !== null) {
        throw SubstrateError.conflict(
          `Task '${input.task_id}' is archived; cannot comment on an archived task.`,
          { entity: 'task', id: input.task_id },
        );
      }

      if (input.parent_id !== undefined) {
        const parent = await getComment(tx, input.parent_id); // not_found if missing
        if (parent.task_id !== input.task_id) {
          throw SubstrateError.conflict(
            `parent_id '${input.parent_id}' belongs to a different task.`,
            { entity: 'comment', id: input.parent_id },
          );
        }
        if (parent.archived_at !== null) {
          throw SubstrateError.conflict(
            `Parent comment '${input.parent_id}' is archived; cannot reply to it.`,
            { entity: 'comment', id: input.parent_id },
          );
        }
      }

      // Resolve the board (via the task) for field_schema.comments validation.
      const substrate = await deps.loadSubstrate();
      const board = substrate.boards.find((b) => b.id === task.board_id);
      if (!board) {
        throw SubstrateError.notFound(
          `Board '${task.board_id}' for task '${input.task_id}' not found in substrate.`,
          { entity: 'board', id: task.board_id },
        );
      }
      const customData = input.custom_data ?? {};
      validateFieldSchema({
        field_schema: board.field_schema.comments,
        merged_custom_data: customData,
        touched_keys: Object.keys(customData),
      });

      const built: Comment = {
        id: randomUUID(),
        task_id: input.task_id,
        parent_id: input.parent_id ?? null,
        body: input.body,
        custom_data: customData,
        created_by_agent: input.agent_name,
        created_at: now,
        edited_at: null,
        archived_at: null,
      };
      await createComment(tx, built);
      await appendEvent(tx, {
        task_id: input.task_id,
        event_type: 'comment_added',
        changes: { comment_id: built.id },
        actor_agent_name: input.agent_name,
        occurred_at: now,
      });
      return built;
    });

    return successEnvelope<Comment>({
      entity: 'comment',
      id: comment.id,
      version: null, // comments are append-only / last-write-wins; no OCC
      state: comment,
    });
  } catch (e) {
    if (SubstrateError.is(e)) return errorEnvelope(e);
    logger.error('Unhandled error in add_comment handler', {
      error: (e as Error).message,
      agent_name: input.agent_name,
    });
    return errorEnvelope(SubstrateError.internalError('Internal error'));
  }
}

export function registerAddComment(server: McpServer, deps: ToolDeps): void {
  server.tool(
    'add_comment',
    'Add a comment to a task. Optional `parent_id` makes it a reply. Markdown bodies allowed. Requires `agent_name`.',
    addCommentShape,
    wrapToolHandler('add_comment', addCommentSchema, (input) => addCommentHandler(input, deps)),
  );
}
