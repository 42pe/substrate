import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  successEnvelope,
  type SuccessEnvelope,
  type ErrorEnvelope,
} from '../../../core/envelope.js';
import type { Board } from '../../../core/types.js';
import { mutateBoardFile } from '../../../substrate/writer.js';
import { wrapToolHandler } from '../../wrapper.js';
import type { ToolDeps } from '../../deps.js';
import { assertVersion, runEdit } from './substrate-edit.js';

/** MCP tool: unarchive_board — restore an archived board. Idempotent. */

export const unarchiveBoardShape = {
  id: z.string().min(1, 'id is required'),
  version: z.number().int().nonnegative(),
  agent_name: z.string().min(1, 'agent_name is required'),
};
export const unarchiveBoardSchema = z.object(unarchiveBoardShape);
export type UnarchiveBoardInput = z.output<typeof unarchiveBoardSchema>;

export function unarchiveBoardHandler(
  input: UnarchiveBoardInput,
  deps: ToolDeps,
): Promise<SuccessEnvelope<Board> | ErrorEnvelope> {
  return runEdit('unarchive_board', input.agent_name, async () => {
    const now = new Date().toISOString();
    const next = await mutateBoardFile(deps.root, input.id, (board) => {
      if (board.archived_at === null) return { result: board, next: board }; // idempotent no-op
      assertVersion(board.version, input.version, board.id);
      const updated: Board = {
        ...board,
        archived_at: null,
        version: board.version + 1,
        updated_at: now,
      };
      return { result: updated, next: updated };
    });
    return successEnvelope<Board>({
      entity: 'board',
      id: next.id,
      version: next.version,
      state: next,
    });
  });
}

export function registerUnarchiveBoard(server: McpServer, deps: ToolDeps): void {
  server.tool(
    'unarchive_board',
    'Restore a previously archived board. Idempotent. Requires `version` and `agent_name`.',
    unarchiveBoardShape,
    wrapToolHandler('unarchive_board', unarchiveBoardSchema, (input) =>
      unarchiveBoardHandler(input, deps),
    ),
  );
}
