import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SubstrateError } from '../../../core/errors.js';
import {
  successEnvelope,
  type SuccessEnvelope,
  type ErrorEnvelope,
} from '../../../core/envelope.js';
import type { Board, FieldSchema } from '../../../core/types.js';
import { createBoardFile } from '../../../substrate/writer.js';
import { validateBoardStructure } from '../../../substrate/validator.js';
import { FieldSchemaSchema } from '../../../substrate/schemas.js';
import { wrapToolHandler } from '../../wrapper.js';
import type { ToolDeps } from '../../deps.js';
import { runEdit } from './substrate-edit.js';

/**
 * MCP tool: create_board — author a new `boards/<uuid>.json`. The board starts
 * with no groups/policies; `field_schema` is optional and structurally
 * validated (`schema_violation` on a malformed schema, before any file write).
 * The board id is a generated UUID (the filename is `<id>.json`).
 */

export const createBoardShape = {
  name: z.string().min(1, 'name is required'),
  description: z.string().optional(),
  field_schema: FieldSchemaSchema.optional(),
  project_id: z.string().min(1).optional(),
  agent_name: z.string().min(1, 'agent_name is required'),
};
export const createBoardSchema = z.object(createBoardShape);
export type CreateBoardInput = z.output<typeof createBoardSchema>;

export function createBoardHandler(
  input: CreateBoardInput,
  deps: ToolDeps,
): Promise<SuccessEnvelope<Board> | ErrorEnvelope> {
  return runEdit('create_board', input.agent_name, async () => {
    if (input.project_id !== undefined && input.project_id !== deps.config.project_id) {
      throw SubstrateError.notFound(`Project '${input.project_id}' not found.`, {
        entity: 'project',
        id: input.project_id,
      });
    }
    const now = new Date().toISOString();
    const board: Board = {
      id: randomUUID(),
      name: input.name,
      description: input.description ?? '',
      // Zod's `.optional()` widens entries to `| undefined`; the validated
      // value is structurally a FieldSchema (cf. loader.ts) — cast bridges the
      // exactOptionalPropertyTypes gap.
      field_schema: (input.field_schema ?? { task: {}, comments: {} }) as FieldSchema,
      groups: [],
      policies: [],
      version: 1,
      created_at: now,
      updated_at: now,
      archived_at: null,
    };
    validateBoardStructure(board); // schema_violation on a bad field_schema — before any write
    await createBoardFile(deps.root, board);
    return successEnvelope<Board>({
      entity: 'board',
      id: board.id,
      version: board.version,
      state: board,
    });
  });
}

export function registerCreateBoard(server: McpServer, deps: ToolDeps): void {
  server.tool(
    'create_board',
    'Create a board. `field_schema` is optional and validated structurally. Returns the board with its generated id. Requires `agent_name`.',
    createBoardShape,
    wrapToolHandler('create_board', createBoardSchema, (input) => createBoardHandler(input, deps)),
  );
}
