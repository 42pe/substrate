import { z } from 'zod';
import { SubstrateError } from './errors.js';

/**
 * Cursor-based pagination shared across every paginated read tool
 * (list_boards, list_tasks, get_task_history, list_comments).
 *
 * Cursors are opaque base64url-encoded JSON of a sort tuple `{ u, i }`:
 *   - `u` = the primary sort value (updated_at / occurred_at ISO string)
 *   - `i` = the tiebreaker id. Generic over its type: tasks/comments use a
 *           string UUID id; task_events use a numeric rowid.
 *
 * The handler does NOT validate that a cursor matches the current filter
 * set — opaque means opaque. Paginating with changed filters yields
 * undefined-but-not-erroring results, which is the standard cursor trade.
 */

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export const paginationShape = z
  .object({
    cursor: z
      .string()
      .optional()
      .describe("Opaque token from a previous response's pagination.next_cursor"),
    page_size: z
      .number()
      .int()
      .min(1)
      .max(MAX_PAGE_SIZE)
      .default(DEFAULT_PAGE_SIZE)
      .describe(`Max items per page. Default ${DEFAULT_PAGE_SIZE}, ceiling ${MAX_PAGE_SIZE}.`),
  })
  .describe('Cursor pagination. Pass the previous response cursor to continue.');

export interface PaginationOutput {
  next_cursor: string | null;
  has_more: boolean;
  page_size: number;
}

export interface CursorTuple<I extends string | number> {
  /** Primary sort value (ISO timestamp). */
  u: string;
  /** Tiebreaker id (string UUID for tasks/comments, number rowid for events). */
  i: I;
}

export function encodeCursor<I extends string | number>(tuple: CursorTuple<I>): string {
  return Buffer.from(JSON.stringify(tuple), 'utf-8').toString('base64url');
}

/**
 * Decode an opaque cursor. Throws `SubstrateError.schemaViolation` on a
 * malformed cursor (so a corrupt token surfaces as a clear client error,
 * not an internal_error).
 */
export function decodeCursor<I extends string | number>(cursor: string): CursorTuple<I> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8'));
  } catch {
    throw SubstrateError.schemaViolation(
      'Malformed pagination cursor. Omit it to start from the first page.',
      {
        cursor,
      },
    );
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>)['u'] !== 'string' ||
    !['string', 'number'].includes(typeof (parsed as Record<string, unknown>)['i'])
  ) {
    throw SubstrateError.schemaViolation(
      'Malformed pagination cursor. Omit it to start from the first page.',
      {
        cursor,
      },
    );
  }
  return parsed as CursorTuple<I>;
}
