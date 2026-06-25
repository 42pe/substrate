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
 * Most filters map straight to indexed WHERE clauses in the repo. Two need
 * handler-side work:
 *   - `missing_required_fields`: requires `board_id` (we need one board's
 *     schema). The handler loads the substrate, derives the required-key list
 *     from that board's `field_schema.task`, and passes it to the repo, which
 *     binds each JSON path as an arg (never interpolated).
 *   - everything else is pushed down to SQL.
 *
 * Only one `custom_field` predicate per call (no compound all_of/any_of in
 * Phase 2 — to combine, call twice and intersect client-side).
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

export const listTasksShape = {
  filters: z
    .object({
      board_id: z.string().min(1).optional(),
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
    })
    .optional()
    .default({}),
  sort: z
    .object({
      field: z.enum(['created_at', 'updated_at']),
      direction: z.enum(['asc', 'desc']),
    })
    .optional(),
  pagination: paginationShape.optional(),
  // Absent ⇒ summary (the handler treats only 'full' specially). Left optional
  // rather than `.default('summary')` so direct (non-Zod) callers — and the
  // output type — don't have to carry the field.
  view: z.enum(['summary', 'full']).optional(),
};
const listTasksSchema = z.object(listTasksShape);
export type ListTasksInput = z.output<typeof listTasksSchema>;

export async function listTasksToolHandler(
  input: ListTasksInput,
  deps: ToolDeps,
): Promise<{ results: TaskSummary[] | Task[]; pagination: PaginationOutput }> {
  const { missing_required_fields, custom_field, ...rest } = input.filters;

  let requiredTaskFields: string[] | undefined;
  if (missing_required_fields) {
    if (!rest.board_id) {
      throw SubstrateError.schemaViolation(
        'missing_required_fields requires filters.board_id (the required-field set is per-board). Set board_id and retry.',
        { filter: 'missing_required_fields' },
      );
    }
    const substrate = await deps.loadSubstrate();
    const board = substrate.boards.find((b) => b.id === rest.board_id);
    if (!board) {
      throw SubstrateError.notFound(
        `Board '${rest.board_id}' not found. Use list_boards to see what's available.`,
        { entity: 'board', id: rest.board_id },
      );
    }
    requiredTaskFields = Object.entries(board.field_schema.task)
      .filter(([, entry]) => entry.required === true)
      .map(([field]) => field);

    // If the board declares NO required fields, "tasks missing a required
    // field" is the empty set — short-circuit. Otherwise the repo's
    // `length > 0` guard would silently drop the filter and return every task
    // (a correctness inversion). Reviewer C1.
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
  // Default: project to lean summary rows (description → excerpt, custom_data
  // trimmed). Filtering already ran in SQL against the full rows, so a value
  // omitted from the projection was still matchable.
  return { results: full.results.map(toTaskSummary), pagination: full.pagination };
}

export function registerListTasks(server: McpServer, deps: ToolDeps): void {
  server.tool(
    'list_tasks',
    [
      'Query tasks with filters (board, group membership, custom_field predicates, text search, missing required fields). Paginated — pass `pagination.cursor` from the previous response to continue.',
      'Returns lightweight SUMMARY rows by default: id, title, group_id, version, timestamps, a `description_excerpt` (+ `description_truncated`), and a `custom_data` trimmed to small scalar values (booleans, numbers, short strings — e.g. gate flags and priority) with any bulky keys listed in `custom_data_omitted`. This keeps a list small enough to read; call `get_task(id)` for the full description and custom_data.',
      "Pass `view: 'full'` to get complete `description` + `custom_data` on every row (heavier — only when you truly need all values without per-task reads).",
      'Filtering is unaffected by the summary: `custom_field` predicates and `missing_required_fields` run against the full task, so you can filter on a field even when its value is omitted from the row.',
    ].join('\n'),
    listTasksShape,
    wrapToolHandler('list_tasks', listTasksSchema, (input) => listTasksToolHandler(input, deps)),
  );
}
