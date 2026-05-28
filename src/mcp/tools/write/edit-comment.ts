import { z } from 'zod';
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
import {
  getComment,
  editComment,
  type CommentPatch,
} from '../../../storage/repositories/comments.js';
import { appendEvent } from '../../../storage/repositories/events.js';
import { withTransaction } from '../../../storage/client.js';
import { validateFieldSchema } from '../../../substrate/field-validator.js';
import { logger } from '../../../shared/logger.js';
import { wrapToolHandler } from '../../wrapper.js';
import type { ToolDeps } from '../../deps.js';

/**
 * MCP tool: edit_comment — last-write-wins (no version).
 *
 * `custom_data` merges key-by-key (null deletes a key), like update_task. The
 * `comment_edited` event carries the prior `body`/`custom_data` in `before` so
 * text lost to a concurrent last-write-wins edit is recoverable from history
 * (spec Q2).
 */

export const editCommentShape = {
  id: z.string().min(1, 'id is required'),
  body: z.string().min(1).optional(),
  custom_data: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Partial merge: only keys you send are touched. Use null to delete a key.'),
  agent_name: z.string().min(1, 'agent_name is required'),
};

export const editCommentSchema = z.object(editCommentShape);
export type EditCommentInput = z.output<typeof editCommentSchema>;

export async function editCommentHandler(
  input: EditCommentInput,
  deps: ToolDeps,
): Promise<SuccessEnvelope<Comment> | ErrorEnvelope> {
  try {
    const now = new Date().toISOString();

    const updated = await withTransaction(deps.client, async (tx) => {
      const existing = await getComment(tx, input.id); // not_found if missing

      // custom_data partial merge (null deletes).
      const touched = Object.keys(input.custom_data ?? {});
      const merged: Record<string, unknown> = { ...existing.custom_data };
      for (const [k, v] of Object.entries(input.custom_data ?? {})) {
        if (v === null) delete merged[k];
        else merged[k] = v;
      }

      if (input.custom_data !== undefined) {
        // Resolve the board via the comment's task for field_schema.comments.
        const task = await getTask(tx, existing.task_id);
        const substrate = await deps.loadSubstrate();
        const board = substrate.boards.find((b) => b.id === task.board_id);
        if (!board) {
          throw SubstrateError.notFound(
            `Board '${task.board_id}' for comment '${input.id}' not found in substrate.`,
            { entity: 'board', id: task.board_id },
          );
        }
        validateFieldSchema({
          field_schema: board.field_schema.comments,
          merged_custom_data: merged,
          touched_keys: touched,
        });
      }

      const patch: CommentPatch = {
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.custom_data !== undefined ? { custom_data: merged } : {}),
      };
      const result = await editComment(tx, input.id, patch, now);

      // comment_edited carries before/after for the touched fields, incl. the
      // prior body for forensic recovery from last-write-wins loss.
      const before: { body?: string; custom_data?: Record<string, unknown> } = {};
      const after: { body?: string; custom_data?: Record<string, unknown> } = {};
      if (input.body !== undefined) {
        before.body = existing.body;
        after.body = input.body;
      }
      if (input.custom_data !== undefined) {
        before.custom_data = existing.custom_data;
        after.custom_data = merged;
      }
      await appendEvent(tx, {
        task_id: existing.task_id,
        event_type: 'comment_edited',
        changes: { comment_id: input.id, before, after },
        actor_agent_name: input.agent_name,
        occurred_at: now,
      });

      return result;
    });

    return successEnvelope<Comment>({
      entity: 'comment',
      id: updated.id,
      version: null,
      state: updated,
    });
  } catch (e) {
    if (SubstrateError.is(e)) return errorEnvelope(e);
    logger.error('Unhandled error in edit_comment handler', {
      error: (e as Error).message,
      agent_name: input.agent_name,
    });
    return errorEnvelope(SubstrateError.internalError('Internal error'));
  }
}

export function registerEditComment(server: McpServer, deps: ToolDeps): void {
  server.tool(
    'edit_comment',
    "Edit a comment's body or `custom_data`. Last-write-wins (no version). Requires `agent_name`.",
    editCommentShape,
    wrapToolHandler('edit_comment', editCommentSchema, (input) => editCommentHandler(input, deps)),
  );
}
