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

/**
 * MCP tool: archive_board — soft-delete a board. Idempotent: an already-archived
 * board returns the current state with no version bump (no OCC needed for a
 * no-op, mirroring task archive).
 */

export const archiveBoardShape = {
  id: z.string().min(1, 'id is required'),
  version: z.number().int().nonnegative(),
  agent_name: z.string().min(1, 'agent_name is required'),
};
export const archiveBoardSchema = z.object(archiveBoardShape);
export type ArchiveBoardInput = z.output<typeof archiveBoardSchema>;

export function archiveBoardHandler(
  input: ArchiveBoardInput,
  deps: ToolDeps,
): Promise<SuccessEnvelope<Board> | ErrorEnvelope> {
  return runEdit('archive_board', input.agent_name, async () => {
    const now = new Date().toISOString();
    const next = await mutateBoardFile(deps.root, input.id, (board) => {
      if (board.archived_at !== null) return { result: board, next: board }; // idempotent no-op
      assertVersion(board.version, input.version, board.id);
      const updated: Board = {
        ...board,
        archived_at: now,
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

export function registerArchiveBoard(server: McpServer, deps: ToolDeps): void {
  server.tool(
    'archive_board',
    'Soft-delete a board (sets `archived_at`). Idempotent. Requires `version` and `agent_name`. Use `unarchive_board` to undo.',
    archiveBoardShape,
    wrapToolHandler('archive_board', archiveBoardSchema, (input) =>
      archiveBoardHandler(input, deps),
    ),
  );
}
