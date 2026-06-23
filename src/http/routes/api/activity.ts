import { z } from 'zod';
import type { ToolDeps } from '../../../mcp/deps.js';
import { paginationShape, type PaginationOutput } from '../../../core/pagination.js';
import { listProjectEvents, type ProjectEvent } from '../../../storage/repositories/events.js';

/**
 * Project-wide activity feed (Theme 4a) — HTTP-only, NOT an MCP tool.
 *
 * Backs `GET /api/activity`, which the read-only inspector polls to show
 * "who did what, when" across every board: task creates/updates/archives,
 * comment activity, guard `move_blocked` rejections, and the `policies_fired`
 * carried on write events. Agents don't need this (they read per-task history
 * via `get_task_history`), so it stays off the MCP surface — same precedent as
 * `/api/health` and `/api/boards/:id/columns`.
 *
 * Board names come from substrate-as-code (`loadSubstrate`), joined to each
 * event's `board_id` in TypeScript; the events + task titles come from SQLite.
 */

export interface ActivityEvent extends ProjectEvent {
  /** Resolved from substrate-as-code; null if the board was archived/removed. */
  board_name: string | null;
}

export interface ActivityResult {
  results: ActivityEvent[];
  pagination: PaginationOutput;
}

export const activityShape = {
  pagination: paginationShape.optional(),
};
export type ActivityInput = z.output<z.ZodObject<typeof activityShape>>;

export async function getActivityHandler(
  input: ActivityInput,
  deps: ToolDeps,
): Promise<ActivityResult> {
  const { results, pagination } = await listProjectEvents(deps.client, input.pagination);

  const substrate = await deps.loadSubstrate();
  const boardName = new Map(substrate.boards.map((b) => [b.id, b.name]));

  return {
    results: results.map((e) => ({
      ...e,
      board_name: e.board_id !== null ? (boardName.get(e.board_id) ?? null) : null,
    })),
    pagination,
  };
}
