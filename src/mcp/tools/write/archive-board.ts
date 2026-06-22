import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  successEnvelope,
  type SuccessEnvelope,
  type ErrorEnvelope,
} from '../../../core/envelope.js';
import type { Board } from '../../../core/types.js';
import { SubstrateError } from '../../../core/errors.js';
import { mutateBoardFile } from '../../../substrate/writer.js';
import { wrapToolHandler } from '../../wrapper.js';
import type { ToolDeps } from '../../deps.js';
import { assertVersion, runEdit } from './substrate-edit.js';

/**
 * MCP tool: archive_board — soft-delete a board. Rejected with `conflict` if any
 * active (non-archived) task is still on it (archive or move them first),
 * mirroring `archive_group`. Idempotent: an already-archived board returns the
 * current state with no version bump and no conflict check (no-op).
 *
 * Like `archive_group`, the active-task DB check is not atomic with the board-
 * file write (R7 accepted residual) — fine for single-user v1.
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
    // Conflict if the board still holds active tasks. Skip for an already-
    // archived board so re-archiving stays an idempotent no-op below.
    const substrate = await deps.loadSubstrate();
    const current = substrate.boards.find((b) => b.id === input.id);
    if (current && current.archived_at === null) {
      const active = await deps.client.execute({
        sql: 'SELECT 1 FROM tasks WHERE board_id = ? AND archived_at IS NULL LIMIT 1',
        args: [input.id],
      });
      if (active.rows.length > 0) {
        throw SubstrateError.conflict(
          `Board '${input.id}' has active tasks. Archive or move them before archiving the board.`,
          { entity: 'board', id: input.id },
        );
      }
    }

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
