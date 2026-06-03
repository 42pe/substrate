import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SubstrateError } from '../../../core/errors.js';
import {
  successEnvelope,
  type SuccessEnvelope,
  type ErrorEnvelope,
} from '../../../core/envelope.js';
import type { Group } from '../../../core/types.js';
import { mutateBoardFile } from '../../../substrate/writer.js';
import { wrapToolHandler } from '../../wrapper.js';
import type { ToolDeps } from '../../deps.js';
import { runEdit } from './substrate-edit.js';

/**
 * MCP tool: reorder_groups — atomically set group order on a board. `ordered_ids`
 * must be a permutation of the board's group ids (`schema_violation` otherwise).
 * Rewrites each group's `position` to its index. Board-level op (no per-group
 * version param); bumps the board version.
 */

export const reorderGroupsShape = {
  board_id: z.string().min(1, 'board_id is required'),
  ordered_ids: z.array(z.string().min(1)).min(1, 'ordered_ids is required'),
  agent_name: z.string().min(1, 'agent_name is required'),
};
export const reorderGroupsSchema = z.object(reorderGroupsShape);
export type ReorderGroupsInput = z.output<typeof reorderGroupsSchema>;

export function reorderGroupsHandler(
  input: ReorderGroupsInput,
  deps: ToolDeps,
): Promise<SuccessEnvelope<Group[]> | ErrorEnvelope> {
  return runEdit('reorder_groups', input.agent_name, async () => {
    const now = new Date().toISOString();
    const out = await mutateBoardFile(deps.root, input.board_id, (board) => {
      const currentIds = board.groups.map((g) => g.id).sort();
      const givenIds = [...input.ordered_ids].sort();
      const isPermutation =
        currentIds.length === givenIds.length && currentIds.every((id, i) => id === givenIds[i]);
      if (!isPermutation) {
        throw SubstrateError.schemaViolation(
          'ordered_ids must be exactly the board’s group ids (a permutation). Use get_board_substrate to see them.',
          { board_id: input.board_id },
        );
      }
      const posById = new Map(input.ordered_ids.map((id, i) => [id, i]));
      const reordered = board.groups
        .map((g) => ({ ...g, position: posById.get(g.id)! }))
        .sort((a, b) => a.position - b.position);
      const nextVersion = board.version + 1;
      return {
        result: { groups: reordered, version: nextVersion },
        next: { ...board, groups: reordered, version: nextVersion, updated_at: now },
      };
    });
    return successEnvelope<Group[]>({
      entity: 'board',
      id: input.board_id,
      version: out.version, // the board's new version (C3)
      state: out.groups,
    });
  });
}

export function registerReorderGroups(server: McpServer, deps: ToolDeps): void {
  server.tool(
    'reorder_groups',
    "Set a board's group order. `ordered_ids` must be exactly the board's group ids. Requires `agent_name`.",
    reorderGroupsShape,
    wrapToolHandler('reorder_groups', reorderGroupsSchema, (input) =>
      reorderGroupsHandler(input, deps),
    ),
  );
}
