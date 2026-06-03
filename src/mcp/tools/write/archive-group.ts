import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SubstrateError } from '../../../core/errors.js';
import {
  successEnvelope,
  type SuccessEnvelope,
  type ErrorEnvelope,
} from '../../../core/envelope.js';
import type { Group } from '../../../core/types.js';
import { mutateBoardFile, findBoardHolding } from '../../../substrate/writer.js';
import { wrapToolHandler } from '../../wrapper.js';
import type { ToolDeps } from '../../deps.js';
import { assertVersion, runEdit } from './substrate-edit.js';

/**
 * MCP tool: archive_group — soft-delete a group. Rejected with `conflict` if any
 * active (non-archived) task references it (move tasks first). Idempotent.
 *
 * R7 (accepted residual): the active-task DB check is not atomic with the board-
 * file write — a concurrent task write into the group can race past it. Accepted
 * for single-user v1; reads/engine tolerate an archived group with live tasks.
 */

export const archiveGroupShape = {
  id: z.string().min(1, 'id is required'),
  version: z.number().int().nonnegative(),
  agent_name: z.string().min(1, 'agent_name is required'),
};
export const archiveGroupSchema = z.object(archiveGroupShape);
export type ArchiveGroupInput = z.output<typeof archiveGroupSchema>;

function notFound(id: string): SubstrateError {
  return SubstrateError.notFound(`Group '${id}' not found in any board.`, { entity: 'group', id });
}

export function archiveGroupHandler(
  input: ArchiveGroupInput,
  deps: ToolDeps,
): Promise<SuccessEnvelope<Group> | ErrorEnvelope> {
  return runEdit('archive_group', input.agent_name, async () => {
    const substrate = await deps.loadSubstrate();
    const board = findBoardHolding(substrate, input.id, 'group');
    if (!board) throw notFound(input.id);

    // Conflict if an active task still references this group.
    const active = await deps.client.execute({
      sql: 'SELECT 1 FROM tasks WHERE group_id = ? AND archived_at IS NULL LIMIT 1',
      args: [input.id],
    });
    if (active.rows.length > 0) {
      throw SubstrateError.conflict(
        `Group '${input.id}' has active tasks. Move or archive them before archiving the group.`,
        { entity: 'group', id: input.id },
      );
    }

    const now = new Date().toISOString();
    const group = await mutateBoardFile(deps.root, board.id, (b) => {
      const idx = b.groups.findIndex((g) => g.id === input.id);
      if (idx === -1) throw notFound(input.id);
      const g = b.groups[idx]!;
      if (g.archived_at !== null) return { result: g, next: b }; // idempotent no-op
      assertVersion(g.version, input.version, g.id);
      const archived: Group = { ...g, archived_at: now, version: g.version + 1 };
      const groups = [...b.groups];
      groups[idx] = archived;
      return {
        result: archived,
        next: { ...b, groups, version: b.version + 1, updated_at: now },
      };
    });
    return successEnvelope<Group>({
      entity: 'group',
      id: group.id,
      version: group.version,
      state: group,
    });
  });
}

export function registerArchiveGroup(server: McpServer, deps: ToolDeps): void {
  server.tool(
    'archive_group',
    'Soft-delete a group. Rejected with `conflict` if active tasks reference it. Idempotent. Requires `version` and `agent_name`.',
    archiveGroupShape,
    wrapToolHandler('archive_group', archiveGroupSchema, (input) =>
      archiveGroupHandler(input, deps),
    ),
  );
}
