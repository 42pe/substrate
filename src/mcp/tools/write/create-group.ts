import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  successEnvelope,
  type SuccessEnvelope,
  type ErrorEnvelope,
} from '../../../core/envelope.js';
import type { Group } from '../../../core/types.js';
import { mutateBoardFile } from '../../../substrate/writer.js';
import { validateBoardStructure } from '../../../substrate/validator.js';
import { wrapToolHandler } from '../../wrapper.js';
import type { ToolDeps } from '../../deps.js';
import { runEdit } from './substrate-edit.js';

/**
 * MCP tool: create_group — append a group to a board. No version param
 * (last-write-wins, per the design-doc signature). `position` defaults to the
 * next slot. `not_found` if the board doesn't exist.
 */

export const createGroupShape = {
  board_id: z.string().min(1, 'board_id is required'),
  name: z.string().min(1, 'name is required'),
  description: z.string().optional(),
  position: z.number().int().optional(),
  color: z.string().min(1).optional(),
  agent_name: z.string().min(1, 'agent_name is required'),
};
export const createGroupSchema = z.object(createGroupShape);
export type CreateGroupInput = z.output<typeof createGroupSchema>;

export function createGroupHandler(
  input: CreateGroupInput,
  deps: ToolDeps,
): Promise<SuccessEnvelope<Group> | ErrorEnvelope> {
  return runEdit('create_group', input.agent_name, async () => {
    const now = new Date().toISOString();
    const group = await mutateBoardFile(deps.root, input.board_id, (board) => {
      const position =
        input.position ?? board.groups.reduce((max, g) => Math.max(max, g.position), -1) + 1;
      const g: Group = {
        id: randomUUID(),
        name: input.name,
        description: input.description ?? '',
        position,
        color: input.color ?? null,
        version: 1,
        archived_at: null,
      };
      const updated = {
        ...board,
        groups: [...board.groups, g],
        version: board.version + 1,
        updated_at: now,
      };
      validateBoardStructure(updated);
      return { result: g, next: updated };
    });
    return successEnvelope<Group>({
      entity: 'group',
      id: group.id,
      version: group.version,
      state: group,
    });
  });
}

export function registerCreateGroup(server: McpServer, deps: ToolDeps): void {
  server.tool(
    'create_group',
    'Add a group to a board. `position` defaults to the next slot. Requires `agent_name`.',
    createGroupShape,
    wrapToolHandler('create_group', createGroupSchema, (input) => createGroupHandler(input, deps)),
  );
}
