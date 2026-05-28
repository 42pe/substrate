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
import { unarchiveTask } from '../../../storage/repositories/tasks.js';
import { appendEvent } from '../../../storage/repositories/events.js';
import { withTransaction } from '../../../storage/client.js';
import { logger } from '../../../shared/logger.js';
import { wrapToolHandler } from '../../wrapper.js';
import type { ToolDeps } from '../../deps.js';

/**
 * MCP tool: unarchive_task — restore a previously archived task.
 *
 * Idempotent: unarchiving a non-archived task succeeds as a no-op with no
 * version bump and emits NO `unarchived` event. Handler owns the transaction.
 */

export const unarchiveTaskShape = {
  id: z.string().min(1, 'id is required'),
  version: z.number().int().nonnegative(),
  agent_name: z.string().min(1, 'agent_name is required'),
};

export const unarchiveTaskSchema = z.object(unarchiveTaskShape);
export type UnarchiveTaskInput = z.output<typeof unarchiveTaskSchema>;

export async function unarchiveTaskHandler(
  input: UnarchiveTaskInput,
  deps: ToolDeps,
): Promise<SuccessEnvelope<Task> | ErrorEnvelope> {
  try {
    const now = new Date().toISOString();
    const { task } = await withTransaction(deps.client, async (tx) => {
      const res = await unarchiveTask(tx, input.id, input.version, now);
      if (res.changed) {
        await appendEvent(tx, {
          task_id: input.id,
          event_type: 'unarchived',
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
    logger.error('Unhandled error in unarchive_task handler', {
      error: (e as Error).message,
      agent_name: input.agent_name,
    });
    return errorEnvelope(SubstrateError.internalError('Internal error'));
  }
}

export function registerUnarchiveTask(server: McpServer, deps: ToolDeps): void {
  server.tool(
    'unarchive_task',
    'Restore a previously archived task. Requires `version` and `agent_name`.',
    unarchiveTaskShape,
    wrapToolHandler('unarchive_task', unarchiveTaskSchema, (input) =>
      unarchiveTaskHandler(input, deps),
    ),
  );
}
