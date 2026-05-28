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
import { archiveComment } from '../../../storage/repositories/comments.js';
import { appendEvent } from '../../../storage/repositories/events.js';
import { withTransaction } from '../../../storage/client.js';
import { logger } from '../../../shared/logger.js';
import { wrapToolHandler } from '../../wrapper.js';
import type { ToolDeps } from '../../deps.js';

/**
 * MCP tool: archive_comment — soft-delete a comment.
 *
 * Idempotent: re-archiving an already-archived comment succeeds as a no-op and
 * emits NO `comment_archived` event. Handler owns the transaction.
 */

export const archiveCommentShape = {
  id: z.string().min(1, 'id is required'),
  agent_name: z.string().min(1, 'agent_name is required'),
};

export const archiveCommentSchema = z.object(archiveCommentShape);
export type ArchiveCommentInput = z.output<typeof archiveCommentSchema>;

export async function archiveCommentHandler(
  input: ArchiveCommentInput,
  deps: ToolDeps,
): Promise<SuccessEnvelope<Comment> | ErrorEnvelope> {
  try {
    const now = new Date().toISOString();
    const { comment } = await withTransaction(deps.client, async (tx) => {
      const res = await archiveComment(tx, input.id, now);
      if (res.changed) {
        await appendEvent(tx, {
          task_id: res.comment.task_id,
          event_type: 'comment_archived',
          changes: { comment_id: input.id },
          actor_agent_name: input.agent_name,
          occurred_at: now,
        });
      }
      return res;
    });

    return successEnvelope<Comment>({
      entity: 'comment',
      id: comment.id,
      version: null,
      state: comment,
    });
  } catch (e) {
    if (SubstrateError.is(e)) return errorEnvelope(e);
    logger.error('Unhandled error in archive_comment handler', {
      error: (e as Error).message,
      agent_name: input.agent_name,
    });
    return errorEnvelope(SubstrateError.internalError('Internal error'));
  }
}

export function registerArchiveComment(server: McpServer, deps: ToolDeps): void {
  server.tool(
    'archive_comment',
    'Soft-delete a comment. Requires `agent_name`.',
    archiveCommentShape,
    wrapToolHandler('archive_comment', archiveCommentSchema, (input) =>
      archiveCommentHandler(input, deps),
    ),
  );
}
