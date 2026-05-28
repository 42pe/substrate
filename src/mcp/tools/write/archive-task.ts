import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SubstrateError } from '../../../core/errors.js';
import {
  successEnvelope,
  errorEnvelope,
  type SuccessEnvelope,
  type ErrorEnvelope,
} from '../../../core/envelope.js';
import type { Task } from '../../../core/types.js';
import { archiveTask } from '../../../storage/repositories/tasks.js';
import { appendEvent } from '../../../storage/repositories/events.js';
import { withTransaction } from '../../../storage/client.js';
import { logger } from '../../../shared/logger.js';
import { wrapToolHandler } from '../../wrapper.js';
import type { ToolDeps } from '../../deps.js';

/**
 * MCP tool: archive_task — soft-delete (sets `archived_at`, preserves history).
 *
 * Idempotent: re-archiving an already-archived task succeeds as a no-op with no
 * version bump and emits NO `archived` event (no state change → no event, per
 * spec decision #5). Handler owns the transaction so the archive and its event
 * are atomic.
 */

export const archiveTaskShape = {
  id: z.string().min(1, 'id is required'),
  version: z.number().int().nonnegative(),
  agent_name: z.string().min(1, 'agent_name is required'),
};

export const archiveTaskSchema = z.object(archiveTaskShape);
export type ArchiveTaskInput = z.output<typeof archiveTaskSchema>;

export async function archiveTaskHandler(
  input: ArchiveTaskInput,
  deps: ToolDeps,
): Promise<SuccessEnvelope<Task> | ErrorEnvelope> {
  try {
    const now = new Date().toISOString();
    const { task } = await withTransaction(deps.client, async (tx) => {
      const res = await archiveTask(tx, input.id, input.version, now);
      if (res.changed) {
        await appendEvent(tx, {
          task_id: input.id,
          event_type: 'archived',
          changes: {},
          actor_agent_name: input.agent_name,
          occurred_at: now,
        });
      }
      return res;
    });

    return successEnvelope<Task>({
      entity: 'task',
      id: task.id,
      version: task.version,
      state: task,
    });
  } catch (e) {
    if (SubstrateError.is(e)) return errorEnvelope(e);
    logger.error('Unhandled error in archive_task handler', {
      error: (e as Error).message,
      agent_name: input.agent_name,
    });
    return errorEnvelope(SubstrateError.internalError('Internal error'));
  }
}

export function registerArchiveTask(server: McpServer, deps: ToolDeps): void {
  server.tool(
    'archive_task',
    'Soft-delete a task (sets `archived_at`; preserves history). Requires `version` and `agent_name`. Use `unarchive_task` to undo.',
    archiveTaskShape,
    wrapToolHandler('archive_task', archiveTaskSchema, (input) => archiveTaskHandler(input, deps)),
  );
}
