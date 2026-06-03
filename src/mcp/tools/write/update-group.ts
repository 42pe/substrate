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
 * MCP tool: update_group — patch a group's fields. OCC on group.version. The
 * group's board is located by scanning the substrate; the board file is then
 * re-read fresh and mutated atomically.
 */

export const updateGroupShape = {
  id: z.string().min(1, 'id is required'),
  version: z.number().int().nonnegative(),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  position: z.number().int().optional(),
  color: z.string().min(1).nullable().optional(),
  agent_name: z.string().min(1, 'agent_name is required'),
};
export const updateGroupSchema = z.object(updateGroupShape);
export type UpdateGroupInput = z.output<typeof updateGroupSchema>;

function notFound(id: string): SubstrateError {
  return SubstrateError.notFound(`Group '${id}' not found in any board.`, { entity: 'group', id });
}

export function updateGroupHandler(
  input: UpdateGroupInput,
  deps: ToolDeps,
): Promise<SuccessEnvelope<Group> | ErrorEnvelope> {
  return runEdit('update_group', input.agent_name, async () => {
    const substrate = await deps.loadSubstrate();
    const board = findBoardHolding(substrate, input.id, 'group');
    if (!board) throw notFound(input.id);

    const now = new Date().toISOString();
    const group = await mutateBoardFile(deps.root, board.id, (b) => {
      const idx = b.groups.findIndex((g) => g.id === input.id);
      if (idx === -1) throw notFound(input.id); // race: removed between load and re-read
      const g = b.groups[idx]!;
      assertVersion(g.version, input.version, g.id);
      const updatedGroup: Group = {
        ...g,
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.position !== undefined ? { position: input.position } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
        version: g.version + 1,
      };
      const groups = [...b.groups];
      groups[idx] = updatedGroup;
      return {
        result: updatedGroup,
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

export function registerUpdateGroup(server: McpServer, deps: ToolDeps): void {
  server.tool(
    'update_group',
    'Update a group (name, description, position, color). Requires `version` and `agent_name`.',
    updateGroupShape,
    wrapToolHandler('update_group', updateGroupSchema, (input) => updateGroupHandler(input, deps)),
  );
}
