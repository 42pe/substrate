import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SubstrateError } from '../../../core/errors.js';
import { wrapToolHandler } from '../../wrapper.js';
import type { FieldSchema, Group, Policy } from '../../../core/types.js';
import type { ToolDeps } from '../../deps.js';

/**
 * MCP tool: get_board_substrate — a board's full operating context.
 *
 * Returns groups, field_schema, and policies in one payload. Policies are
 * INCLUDED even though the engine doesn't ship until Phase 3: the v1 paradigm
 * bet is that agents reading policies self-enforce. `not_found` if the board
 * isn't in the substrate.
 */

export const getBoardSubstrateShape = {
  board_id: z.string().min(1, 'board_id is required'),
};
const getBoardSubstrateSchema = z.object(getBoardSubstrateShape);
export type GetBoardSubstrateInput = z.output<typeof getBoardSubstrateSchema>;

export interface BoardSubstrateResult {
  board: {
    id: string;
    name: string;
    description: string;
    version: number;
    created_at: string;
    updated_at: string;
    archived_at: string | null;
  };
  groups: Group[];
  field_schema: FieldSchema;
  policies: Policy[];
}

export async function getBoardSubstrateHandler(
  input: GetBoardSubstrateInput,
  deps: ToolDeps,
): Promise<BoardSubstrateResult> {
  const substrate = await deps.loadSubstrate();
  const board = substrate.boards.find((b) => b.id === input.board_id);
  if (!board) {
    throw SubstrateError.notFound(
      `Board '${input.board_id}' not found. Use list_boards to see what's available.`,
      { entity: 'board', id: input.board_id },
    );
  }
  return {
    board: {
      id: board.id,
      name: board.name,
      description: board.description,
      version: board.version,
      created_at: board.created_at,
      updated_at: board.updated_at,
      archived_at: board.archived_at,
    },
    groups: board.groups,
    field_schema: board.field_schema,
    policies: board.policies,
  };
}

export function registerGetBoardSubstrate(server: McpServer, deps: ToolDeps): void {
  server.tool(
    'get_board_substrate',
    "Fetch a board's complete operating context in one payload: groups, field_schema, and policies. Call this once per board before doing any work on it, then cache.",
    getBoardSubstrateShape,
    wrapToolHandler('get_board_substrate', getBoardSubstrateSchema, (input) =>
      getBoardSubstrateHandler(input, deps),
    ),
  );
}
