import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  successEnvelope,
  type SuccessEnvelope,
  type ErrorEnvelope,
} from '../../../core/envelope.js';
import type { Board, FieldSchema } from '../../../core/types.js';
import { mutateBoardFile } from '../../../substrate/writer.js';
import { validateBoardStructure } from '../../../substrate/validator.js';
import { FieldSchemaSchema } from '../../../substrate/schemas.js';
import { wrapToolHandler } from '../../wrapper.js';
import type { ToolDeps } from '../../deps.js';
import { assertVersion, runEdit } from './substrate-edit.js';

/**
 * MCP tool: update_board — patch a board's name/description/field_schema. OCC on
 * board.version. The post-mutate result is structurally re-validated so a write
 * can never persist a structurally-invalid board.
 */

export const updateBoardShape = {
  id: z.string().min(1, 'id is required'),
  version: z.number().int().nonnegative(),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  field_schema: FieldSchemaSchema.optional(),
  agent_name: z.string().min(1, 'agent_name is required'),
};
export const updateBoardSchema = z.object(updateBoardShape);
export type UpdateBoardInput = z.output<typeof updateBoardSchema>;

export function updateBoardHandler(
  input: UpdateBoardInput,
  deps: ToolDeps,
): Promise<SuccessEnvelope<Board> | ErrorEnvelope> {
  return runEdit('update_board', input.agent_name, async () => {
    const now = new Date().toISOString();
    const next = await mutateBoardFile(deps.root, input.id, (board) => {
      assertVersion(board.version, input.version, board.id);
      const updated: Board = {
        ...board,
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.field_schema !== undefined
          ? { field_schema: input.field_schema as FieldSchema }
          : {}),
        version: board.version + 1,
        updated_at: now,
      };
      validateBoardStructure(updated); // schema_violation before commit
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

export function registerUpdateBoard(server: McpServer, deps: ToolDeps): void {
  server.tool(
    'update_board',
    'Update a board (name, description, field_schema). Requires `version` and `agent_name`. Schema changes never reject existing data (lazy validation).',
    updateBoardShape,
    wrapToolHandler('update_board', updateBoardSchema, (input) => updateBoardHandler(input, deps)),
  );
}
