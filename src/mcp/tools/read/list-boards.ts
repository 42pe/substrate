import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { wrapToolHandler } from '../../wrapper.js';
import {
  paginationShape,
  type PaginationOutput,
  type CursorTuple,
  encodeCursor,
  decodeCursor,
  DEFAULT_PAGE_SIZE,
} from '../../../core/pagination.js';
import type { ToolDeps } from '../../deps.js';
import type { BoardSummary } from './whoami.js';

/**
 * MCP tool: list_boards — paginated board summaries.
 *
 * Boards live in substrate-as-code (a handful of JSON files), so this paginates
 * the in-memory array rather than hitting SQLite. Sorted by board id for a
 * stable keyset cursor. `archived` filters: omitted ⇒ all, true ⇒ archived
 * only, false ⇒ active only.
 */

export const listBoardsShape = {
  archived: z
    .boolean()
    .optional()
    .describe('true → archived only; false → active only; omit → all'),
  pagination: paginationShape.optional(),
};
const listBoardsSchema = z.object(listBoardsShape);
export type ListBoardsInput = z.output<typeof listBoardsSchema>;

export async function listBoardsHandler(
  input: ListBoardsInput,
  deps: ToolDeps,
): Promise<{ results: BoardSummary[]; pagination: PaginationOutput }> {
  const substrate = await deps.loadSubstrate();

  let boards = substrate.boards;
  if (input.archived === true) {
    boards = boards.filter((b) => b.archived_at !== null);
  } else if (input.archived === false) {
    boards = boards.filter((b) => b.archived_at === null);
  }

  const sorted = [...boards].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  let startIdx = 0;
  if (input.pagination?.cursor) {
    const cur = decodeCursor<string>(input.pagination.cursor);
    startIdx = sorted.findIndex((b) => b.id > cur.i);
    if (startIdx === -1) startIdx = sorted.length;
  }

  const pageSize = input.pagination?.page_size ?? DEFAULT_PAGE_SIZE;
  const slice = sorted.slice(startIdx, startIdx + pageSize);
  const hasMore = startIdx + pageSize < sorted.length;

  let nextCursor: string | null = null;
  if (hasMore && slice.length > 0) {
    const last = slice[slice.length - 1]!;
    const tuple: CursorTuple<string> = { u: last.id, i: last.id };
    nextCursor = encodeCursor(tuple);
  }

  return {
    results: slice.map((b) => ({
      id: b.id,
      name: b.name,
      description: b.description,
      archived_at: b.archived_at,
      version: b.version,
    })),
    pagination: { next_cursor: nextCursor, has_more: hasMore, page_size: pageSize },
  };
}

export function registerListBoards(server: McpServer, deps: ToolDeps): void {
  server.tool(
    'list_boards',
    'List board summaries with optional `archived` filter. Use `whoami` first; only call this if you need a fresh paginated view.',
    listBoardsShape,
    wrapToolHandler('list_boards', listBoardsSchema, (input) => listBoardsHandler(input, deps)),
  );
}
