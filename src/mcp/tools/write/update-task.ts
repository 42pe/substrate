import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SubstrateError } from '../../../core/errors.js';
import {
  successEnvelope,
  errorEnvelope,
  type SuccessEnvelope,
  type ErrorEnvelope,
  type PolicyFiredEntry,
} from '../../../core/envelope.js';
import type { Task } from '../../../core/types.js';
import { getTask, updateTask, type TaskPatch } from '../../../storage/repositories/tasks.js';
import { appendEvent } from '../../../storage/repositories/events.js';
import { withTransaction } from '../../../storage/client.js';
import { validateFieldSchema } from '../../../substrate/field-validator.js';
import { runTransitionGuards, runAgentResponsibilities } from '../../../policy/engine.js';
import { logger } from '../../../shared/logger.js';
import { wrapToolHandler } from '../../wrapper.js';
import type { ToolDeps } from '../../deps.js';

/**
 * MCP tool: update_task.
 *
 * Send only the fields to change. `custom_data` merges key-by-key (a `null`
 * value deletes a key); other keys are preserved. `board_id` and `parent_id`
 * are intentionally NOT in the shape — board is immutable, parent reassignment
 * is deferred — so passing them is a schema_violation via the wrapper.
 *
 * The handler owns the transaction: read-for-merge, OCC update, and the
 * `updated` TaskEvent all run inside one `withTransaction`, so the OCC read and
 * the write can't be split by a concurrent writer and the audit entry is atomic
 * with the update.
 */

export const updateTaskShape = {
  id: z.string().min(1, 'id is required'),
  version: z.number().int().nonnegative(),
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  custom_data: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Partial merge: only keys you send are touched. Use null to delete a key.'),
  group_id: z.string().min(1).optional(),
  agent_name: z.string().min(1, 'agent_name is required'),
};

export const updateTaskSchema = z.object(updateTaskShape);
export type UpdateTaskInput = z.output<typeof updateTaskSchema>;

export async function updateTaskHandler(
  input: UpdateTaskInput,
  deps: ToolDeps,
): Promise<SuccessEnvelope<Task> | ErrorEnvelope> {
  try {
    const now = new Date().toISOString();

    const updated = await withTransaction(deps.client, async (tx) => {
      const existing = await getTask(tx, input.id);

      // Resolve the board for field_schema validation. Board is immutable, so
      // it's the task's own board_id. Missing from substrate → not_found.
      const substrate = await deps.loadSubstrate();
      const board = substrate.boards.find((b) => b.id === existing.board_id);
      if (!board) {
        throw SubstrateError.notFound(
          `Board '${existing.board_id}' for task '${input.id}' not found in substrate.`,
          { entity: 'board', id: existing.board_id },
        );
      }

      // custom_data partial merge (null deletes).
      const touched = Object.keys(input.custom_data ?? {});
      const merged: Record<string, unknown> = { ...existing.custom_data };
      for (const [k, v] of Object.entries(input.custom_data ?? {})) {
        if (v === null) delete merged[k];
        else merged[k] = v;
      }
      validateFieldSchema({
        field_schema: board.field_schema.task,
        merged_custom_data: merged,
        touched_keys: touched,
      });

      const patch: TaskPatch = {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.group_id !== undefined ? { group_id: input.group_id } : {}),
        ...(input.custom_data !== undefined ? { custom_data: merged } : {}),
      };

      // transition_guards fire only on an actual group change. Evaluate against
      // the candidate post-write task (existing ∪ patch, with merged custom_data)
      // so guard `require` sees the about-to-be-written values. A block throws
      // transition_blocked INSIDE the tx → the whole write rolls back.
      let guardEntries: PolicyFiredEntry[] = [];
      if (input.group_id !== undefined && input.group_id !== existing.group_id) {
        const candidate: Task = { ...existing, ...patch };
        guardEntries = runTransitionGuards({
          board,
          fromGroup: existing.group_id,
          toGroup: input.group_id,
          candidate: { task: candidate as unknown as Record<string, unknown> },
        });
      }

      const result = await updateTask(tx, input.id, input.version, patch, now);

      // `updated` event: before/after for touched keys only (spec §3.2).
      const before: Partial<Task> = {};
      const after: Partial<Task> = {};
      if (input.title !== undefined) {
        before.title = existing.title;
        after.title = input.title;
      }
      if (input.description !== undefined) {
        before.description = existing.description;
        after.description = input.description;
      }
      if (input.group_id !== undefined) {
        before.group_id = existing.group_id;
        after.group_id = input.group_id;
      }
      if (input.custom_data !== undefined) {
        before.custom_data = existing.custom_data;
        after.custom_data = merged;
      }

      await appendEvent(tx, {
        task_id: input.id,
        event_type: 'updated',
        changes: { before, after },
        actor_agent_name: input.agent_name,
        occurred_at: now,
      });

      // Hoist board + guard entries out of the tx for the post-commit
      // responsibility pass and envelope assembly (C-5).
      return { result, board, guardEntries };
    });

    // agent_responsibilities run AFTER commit, against the post-write task.
    const responsibilityEntries = runAgentResponsibilities({
      board: updated.board,
      state: { task: updated.result as unknown as Record<string, unknown> },
    });

    return successEnvelope<Task>(
      {
        entity: 'task',
        id: updated.result.id,
        version: updated.result.version,
        state: updated.result,
      },
      updated.guardEntries.concat(responsibilityEntries),
    );
  } catch (e) {
    if (SubstrateError.is(e)) return errorEnvelope(e);
    logger.error('Unhandled error in update_task handler', {
      error: (e as Error).message,
      agent_name: input.agent_name,
    });
    return errorEnvelope(SubstrateError.internalError('Internal error'));
  }
}

export function registerUpdateTask(server: McpServer, deps: ToolDeps): void {
  server.tool(
    'update_task',
    'Update a task’s fields and/or move it between groups. Send only fields you want to change. `custom_data` merges key-by-key (`null` deletes a key). Requires `version` from your last read (returns `version_mismatch` if stale) and `agent_name`.',
    updateTaskShape,
    wrapToolHandler('update_task', updateTaskSchema, (input) => updateTaskHandler(input, deps)),
  );
}
