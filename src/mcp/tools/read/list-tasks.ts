import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SubstrateError } from '../../../core/errors.js';
import { wrapToolHandler } from '../../wrapper.js';
import {
  paginationShape,
  DEFAULT_PAGE_SIZE,
  type PaginationOutput,
} from '../../../core/pagination.js';
import {
  listTasks,
  type ListTasksOptions,
  type ListTasksFilters,
} from '../../../storage/repositories/tasks.js';
import type { Task, TaskSummary } from '../../../core/types.js';
import { toTaskSummary } from '../../../core/task-summary.js';
import type { ToolDeps } from '../../deps.js';

/**
 * MCP tool: list_tasks — filtered, paginated task query.
 *
 * Filters are **top-level params** (`board_id`, `group_id`, `in_groups`, …), not
 * nested. B1 (dogfood 2026-07-07): they used to live under a `filters: {}` object
 * and the group filter was `in_groups` only, so a natural call like
 * `list_tasks({ board_id, group_id })` had its keys silently stripped and the tool
 * returned the WHOLE project. Now: (1) filters are flat, so the reported call
 * works; (2) `group_id` is sugar for `in_groups:[group_id]` (union if both given);
 * (3) the old nested `filters` object is still accepted (deprecated, merged;
 * top-level wins) so existing callers — including the HTTP route — keep working.
 *
 * NOTE on unknown/misspelled keys: `.strict()` below rejects them for direct/HTTP
 * callers, but the MCP SDK (`server.tool` → non-strict `z.object(shape)`) STRIPS
 * unknown keys before this handler ever runs, so a pure typo over MCP is dropped,
 * not rejected. The protection over MCP is that the real filter names are now
 * first-class params — we do NOT claim typo-rejection on the MCP transport.
 *
 * Most filters map straight to indexed WHERE clauses in the repo. `missing_required_fields`
 * needs `board_id` (per-board schema); `custom_field` is one predicate per call.
 */

const customFieldShape = z.object({
  field: z.string().min(1),
  op: z.enum([
    'exists',
    'not_exists',
    'is_empty',
    'not_empty',
    'eq',
    'neq',
    'in',
    'not_in',
    'gt',
    'gte',
    'lt',
    'lte',
    'contains',
  ]),
  value: z.unknown().optional(),
  values: z.array(z.unknown()).optional(),
});

/** The filter fields, shared between the top-level params and the deprecated
 *  nested `filters` alias. */
const filterFieldShapes = {
  board_id: z.string().min(1).optional(),
  group_id: z
    .string()
    .min(1)
    .optional()
    .describe('Restrict to a single group (convenience sugar for in_groups:[group_id]).'),
  in_groups: z.array(z.string()).optional(),
  not_in_groups: z.array(z.string()).optional(),
  parent_id: z.string().nullable().optional(),
  has_subtasks: z.boolean().optional(),
  archived: z.boolean().optional(),
  created_before: z.string().optional(),
  created_after: z.string().optional(),
  updated_before: z.string().optional(),
  updated_after: z.string().optional(),
  custom_field: customFieldShape.optional(),
  missing_required_fields: z.boolean().optional(),
  text_search: z.string().min(1).optional(),
};

export const listTasksShape = {
  ...filterFieldShapes,
  // DEPRECATED: filters used to be nested here. Still accepted — merged with the
  // top-level fields (top-level wins) — so older callers and the HTTP route keep
  // working. Prefer the top-level params.
  filters: z.object(filterFieldShapes).optional(),
  sort: z
    .object({
      field: z.enum(['created_at', 'updated_at']),
      direction: z.enum(['asc', 'desc']),
    })
    .optional(),
  pagination: paginationShape.optional(),
  // Absent ⇒ summary. `full` = complete description + custom_data on every row;
  // `titles` = just id/title/group/version (leanest — for pure selection).
  view: z.enum(['summary', 'full', 'titles']).optional(),
};
// `.strict()`: reject unknown top-level keys for DIRECT/HTTP callers (a
// schema_violation rather than a silent widen). Caveat: over the MCP transport the
// SDK strips unknown keys before this schema is re-parsed (see the header note), so
// strict is a no-op there — it is not the MCP typo defense it may appear to be.
const listTasksSchema = z.object(listTasksShape).strict();
export type ListTasksInput = z.output<typeof listTasksSchema>;

/** Lean selection row for `view: 'titles'`. */
export type TaskTitle = Pick<
  Task,
  'id' | 'board_id' | 'group_id' | 'parent_id' | 'title' | 'version'
>;

function toTaskTitle(t: Task): TaskTitle {
  return {
    id: t.id,
    board_id: t.board_id,
    group_id: t.group_id,
    parent_id: t.parent_id,
    title: t.title,
    version: t.version,
  };
}

const FILTER_KEYS = Object.keys(filterFieldShapes) as (keyof typeof filterFieldShapes)[];

export async function listTasksToolHandler(
  input: ListTasksInput,
  deps: ToolDeps,
): Promise<{ results: TaskSummary[] | Task[] | TaskTitle[]; pagination: PaginationOutput }> {
  // Merge the deprecated nested `filters` (base) with the top-level filter params
  // (they win). Then apply the `group_id` → `in_groups` sugar.
  const raw: Record<string, unknown> = { ...(input.filters ?? {}) };
  const inputRec = input as Record<string, unknown>;
  for (const k of FILTER_KEYS) {
    if (inputRec[k] !== undefined) raw[k] = inputRec[k];
  }
  if (raw['group_id'] !== undefined) {
    const g = raw['group_id'] as string;
    const existing = (raw['in_groups'] as string[] | undefined) ?? [];
    raw['in_groups'] = existing.includes(g) ? existing : [...existing, g];
    delete raw['group_id'];
  }

  const { missing_required_fields, custom_field, ...rest } = raw as {
    missing_required_fields?: boolean;
    custom_field?: z.output<typeof customFieldShape>;
  } & Record<string, unknown>;

  let requiredTaskFields: string[] | undefined;
  if (missing_required_fields) {
    const boardId = rest['board_id'] as string | undefined;
    if (!boardId) {
      throw SubstrateError.schemaViolation(
        'missing_required_fields requires board_id (the required-field set is per-board). Set board_id and retry.',
        { filter: 'missing_required_fields' },
      );
    }
    const substrate = await deps.loadSubstrate();
    const board = substrate.boards.find((b) => b.id === boardId);
    if (!board) {
      throw SubstrateError.notFound(
        `Board '${boardId}' not found. Use list_boards to see what's available.`,
        { entity: 'board', id: boardId },
      );
    }
    requiredTaskFields = Object.entries(board.field_schema.task)
      .filter(([, entry]) => entry.required === true)
      .map(([field]) => field);

    // If the board declares NO required fields, "tasks missing a required field"
    // is the empty set — short-circuit (else the repo's `length > 0` guard would
    // silently drop the filter and return every task). Reviewer C1.
    if (requiredTaskFields.length === 0) {
      const pageSize = input.pagination?.page_size ?? DEFAULT_PAGE_SIZE;
      return {
        results: [],
        pagination: { next_cursor: null, has_more: false, page_size: pageSize },
      };
    }
  }

  // Zod `.optional()` yields `T | undefined`, which exactOptionalPropertyTypes
  // treats as distinct from the exact-optional ListTasksFilters fields. The
  // values are validated; the cast bridges that purely-type-level gap.
  const filters = { ...rest, ...(custom_field ? { custom_field } : {}) } as ListTasksFilters;

  const opts: ListTasksOptions = {
    filters,
    ...(input.sort ? { sort: input.sort } : {}),
    ...(input.pagination ? { pagination: input.pagination } : {}),
    ...(requiredTaskFields ? { requiredTaskFields } : {}),
  };

  const full = await listTasks(deps.client, opts);
  if (input.view === 'full') return full;
  if (input.view === 'titles') {
    return { results: full.results.map(toTaskTitle), pagination: full.pagination };
  }
  // Default: lean summary rows (description → excerpt, custom_data trimmed).
  // Filtering already ran in SQL against the full rows, so a value omitted from
  // the projection was still matchable.
  return { results: full.results.map(toTaskSummary), pagination: full.pagination };
}

export function registerListTasks(server: McpServer, deps: ToolDeps): void {
  server.tool(
    'list_tasks',
    [
      'Query tasks with filters. Filters are TOP-LEVEL params (not nested): `board_id`, `group_id` (single group; sugar for in_groups), `in_groups`/`not_in_groups`, `parent_id`, `has_subtasks`, `archived`, `created_before/after`, `updated_before/after`, `custom_field`, `missing_required_fields`, `text_search`. Use these exact names — an unrecognized key is ignored, so a filter that does not narrow the result likely means a wrong name. Paginated — pass `pagination.cursor` from the previous response to continue.',
      'Returns lightweight SUMMARY rows by default: id, title, group_id, version, timestamps, a `description_excerpt` (+ `description_truncated`), and a `custom_data` trimmed to small scalar values (gate flags, priority, …) with bulky keys listed in `custom_data_omitted`. Call `get_task(id)` for the full description + custom_data.',
      "Use `view: 'titles'` for the leanest rows (id/title/group/version — pure selection), or `view: 'full'` for complete `description` + `custom_data` on every row (heavier).",
      'Filtering is unaffected by the projection: `custom_field` and `missing_required_fields` run against the full task, so you can filter on a field even when its value is omitted from the row.',
    ].join('\n'),
    listTasksShape,
    wrapToolHandler('list_tasks', listTasksSchema, (input) => listTasksToolHandler(input, deps)),
  );
}
