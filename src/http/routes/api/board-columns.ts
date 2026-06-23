import { z } from 'zod';
import { SubstrateError } from '../../../core/errors.js';
import type { Task } from '../../../core/types.js';
import type { ToolDeps } from '../../../mcp/deps.js';
import {
  countActiveTasksByGroup,
  listActiveGroupPreview,
} from '../../../storage/repositories/tasks.js';

/**
 * Kanban columns aggregate (Phase 9) — HTTP-only, NOT an MCP tool.
 *
 * This backs `GET /api/boards/:id/columns`, which the read-only inspector polls
 * to render a board as kanban. It is deliberately not in `src/mcp/tools/`:
 * agents don't need a kanban view (they query `list_tasks` with `in_groups`),
 * so the MCP tool surface / `whoami` identity stays stable. Precedent for an
 * HTTP route with no MCP twin: `/api/health`.
 *
 * Iteration is GROUP-LIST-DRIVEN: columns come from the board's ACTIVE groups
 * (substrate-as-code, via `loadSubstrate`), counts/previews come from SQLite,
 * joined by `group_id` in TypeScript (the two live in different stores — there
 * is no SQL join). A task whose `group_id` is an archived/unknown group is
 * therefore omitted for free: it has no active group to be read out under.
 */

/** Per-column board-detail cap. The Overview wall passes a much smaller limit. */
export const KANBAN_COLUMN_LIMIT = 100;

/**
 * A column task plus the names of any REQUIRED fields it is missing (a required
 * `field_schema.task` key whose `custom_data` value is null/absent — same rule
 * as `list_tasks(missing_required_fields)`). Empty array ⇒ nothing missing. Lets
 * the inspector badge a card that violates its own board's schema (Theme 4b).
 */
export interface ColumnTask extends Task {
  missing_required_fields: string[];
}

export interface BoardColumn {
  group_id: string;
  group_name: string;
  position: number;
  color: string | null;
  /** True count of ACTIVE tasks in this group — independent of `limit`. */
  total: number;
  /** Up to `limit` active tasks, `updated_at DESC`. */
  tasks: ColumnTask[];
}

export interface BoardColumnsResult {
  board_id: string;
  columns: BoardColumn[];
}

/**
 * Query shape for the columns route. `limit`:
 *   - absent           → default `KANBAN_COLUMN_LIMIT`
 *   - negative / zero  → 400 (via `.positive()` — `intParam` lets `-5` through
 *                        as a valid integer, so `.positive()` is load-bearing)
 *   - valid but huge   → CLAMPED to `KANBAN_COLUMN_LIMIT` (intentionally unlike
 *                        `page_size`, which rejects an over-large value)
 * A non-integer is already a 400 upstream via `intParam` in the route.
 */
export const boardColumnsShape = {
  board_id: z.string().min(1, 'board_id is required'),
  limit: z
    .number()
    .int()
    .positive()
    .transform((n) => Math.min(n, KANBAN_COLUMN_LIMIT))
    .default(KANBAN_COLUMN_LIMIT),
};
export type BoardColumnsInput = z.output<z.ZodObject<typeof boardColumnsShape>>;

export async function getBoardColumnsHandler(
  input: BoardColumnsInput,
  deps: ToolDeps,
): Promise<BoardColumnsResult> {
  const substrate = await deps.loadSubstrate();
  const board = substrate.boards.find((b) => b.id === input.board_id);
  if (!board) {
    // Same not-found shape get_board_substrate raises → mapped to 404.
    throw SubstrateError.notFound(
      `Board '${input.board_id}' not found. Use list_boards to see what's available.`,
      { entity: 'board', id: input.board_id },
    );
  }

  const activeGroups = board.groups
    .filter((g) => g.archived_at === null)
    .sort((a, b) => a.position - b.position);

  // Required-field set for this board (per-board, like list_tasks). A task is
  // flagged for any required key whose custom_data value is null/absent.
  const requiredKeys = Object.entries(board.field_schema.task)
    .filter(([, entry]) => entry.required === true)
    .map(([key]) => key);
  const missingRequired = (task: Task): string[] =>
    requiredKeys.filter((k) => task.custom_data[k] === null || task.custom_data[k] === undefined);

  const counts = await countActiveTasksByGroup(deps.client, board.id);

  const columns: BoardColumn[] = [];
  for (const g of activeGroups) {
    const tasks = await listActiveGroupPreview(deps.client, board.id, g.id, input.limit);
    columns.push({
      group_id: g.id,
      group_name: g.name,
      position: g.position,
      color: g.color,
      total: counts.get(g.id) ?? 0,
      tasks: tasks.map((t) => ({ ...t, missing_required_fields: missingRequired(t) })),
    });
  }

  return { board_id: board.id, columns };
}
