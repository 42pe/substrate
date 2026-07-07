import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SubstrateError } from '../../../core/errors.js';
import { wrapToolHandler } from '../../wrapper.js';
import { getTask } from '../../../storage/repositories/tasks.js';
import { runTransitionGuards } from '../../../policy/engine.js';
import type { ToolDeps } from '../../deps.js';

/**
 * MCP tool: check_transition — a DRY-RUN of a group move (dogfood 2026-07-07).
 *
 * "Would moving task X to group Y be allowed by the board's transition_guards?"
 * — evaluated against the task's current state, WITHOUT writing anything and
 * WITHOUT a throwaway task. Reuses the pure `runTransitionGuards` evaluator (the
 * same code the write path runs), so a dry-run and the real move never disagree.
 *
 * Purpose: verify a gate is actually enforced (the dogfood pain was "I proved 1
 * of 5 gates live; the other 4 are unproven, and a silently-dead gate looks
 * enforced"). Now every gate is cheaply checkable.
 */

export const checkTransitionShape = {
  task_id: z.string().min(1, 'task_id is required'),
  to_group: z.string().min(1, 'to_group is required'),
};
const checkTransitionSchema = z.object(checkTransitionShape);
export type CheckTransitionInput = z.output<typeof checkTransitionSchema>;

export interface CheckTransitionResult {
  allowed: boolean;
  from_group: string;
  to_group: string;
  blocked_by?: { policy_id: string | null; message: string };
}

export async function checkTransitionHandler(
  input: CheckTransitionInput,
  deps: ToolDeps,
): Promise<CheckTransitionResult> {
  const task = await getTask(deps.client, input.task_id); // not_found if missing
  const substrate = await deps.loadSubstrate();
  const board = substrate.boards.find((b) => b.id === task.board_id);
  if (!board) {
    throw SubstrateError.notFound(
      `Board '${task.board_id}' for task '${input.task_id}' not found in substrate.`,
      { entity: 'board', id: task.board_id },
    );
  }
  const target = board.groups.find((g) => g.id === input.to_group);
  if (!target) {
    throw SubstrateError.notFound(
      `Group '${input.to_group}' not found in board '${board.id}'. Use get_board_substrate to see its groups.`,
      { entity: 'group', id: input.to_group },
    );
  }

  // A same-group "move" isn't a transition — the write path (update_task) skips
  // guards when group_id is unchanged, so the dry-run must too, or it would
  // report `blocked` for a write that would actually be a no-op.
  if (task.group_id === input.to_group) {
    return { allowed: true, from_group: task.group_id, to_group: input.to_group };
  }

  try {
    runTransitionGuards({
      board,
      fromGroup: task.group_id,
      toGroup: input.to_group,
      candidate: { task: task as unknown as Record<string, unknown> },
    });
    return { allowed: true, from_group: task.group_id, to_group: input.to_group };
  } catch (e) {
    if (SubstrateError.is(e) && e.code === 'transition_blocked') {
      const d = e.details ?? {};
      return {
        allowed: false,
        from_group: task.group_id,
        to_group: input.to_group,
        blocked_by: { policy_id: (d['policy_id'] as string | null) ?? null, message: e.message },
      };
    }
    throw e; // unexpected — let the wrapper surface it
  }
}

export function registerCheckTransition(server: McpServer, deps: ToolDeps): void {
  server.tool(
    'check_transition',
    'Dry-run: would moving a task to a target group be ALLOWED by the board’s transition_guards — WITHOUT writing anything or creating a throwaway task? Returns { allowed, from_group, to_group, blocked_by? }. Use it to verify a human/agent gate is actually enforced (e.g. confirm a "closed requires approval" gate blocks) before relying on it, or to see what a move needs.',
    checkTransitionShape,
    wrapToolHandler('check_transition', checkTransitionSchema, (input) =>
      checkTransitionHandler(input, deps),
    ),
  );
}
