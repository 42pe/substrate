import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SubstrateError } from '../../../core/errors.js';
import { wrapToolHandler } from '../../wrapper.js';
import { paginationShape, type PaginationOutput } from '../../../core/pagination.js';
import {
  listTasks,
  type ListTasksOptions,
  type ListTasksFilters,
} from '../../../storage/repositories/tasks.js';
import type { Task } from '../../../core/types.js';
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
};
const listTasksSchema = z.object(listTasksShape);
export type ListTasksInput = z.output<typeof listTasksSchema>;

export async function listTasksToolHandler(
  input: ListTasksInput,
  deps: ToolDeps,
): Promise<{ results: Task[]; pagination: PaginationOutput }> {
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

  return listTasks(deps.client, opts);
}

export function registerListTasks(server: McpServer, deps: ToolDeps): void {
  server.tool(
    'list_tasks',
    'Query tasks with filters (board, group membership, custom_field predicates, text search, missing required fields). Returns paginated results; pass `pagination.cursor` from the previous response to continue.',
    listTasksShape,
    wrapToolHandler('list_tasks', listTasksSchema, (input) => listTasksToolHandler(input, deps)),
  );
}
