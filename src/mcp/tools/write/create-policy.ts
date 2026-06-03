import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  successEnvelope,
  type SuccessEnvelope,
  type ErrorEnvelope,
} from '../../../core/envelope.js';
import type { Policy } from '../../../core/types.js';
import { mutateBoardFile } from '../../../substrate/writer.js';
import { wrapToolHandler } from '../../wrapper.js';
import type { ToolDeps } from '../../deps.js';
import { runEdit } from './substrate-edit.js';

/**
 * MCP tool: create_policy — append a policy to a board. `definition` is stored
 * as-is (unstructured — the Phase 3 engine tolerates malformed definitions). No
 * version param (LWW). `not_found` if the board doesn't exist.
 */

export const createPolicyShape = {
  board_id: z.string().min(1, 'board_id is required'),
  name: z.string().min(1, 'name is required'),
  description: z.string().optional(),
  type: z.enum(['transition_guard', 'agent_responsibility']),
  definition: z.record(z.string(), z.unknown()),
  priority: z.number().int().optional(),
  enabled: z.boolean().optional(),
  agent_name: z.string().min(1, 'agent_name is required'),
};
export const createPolicySchema = z.object(createPolicyShape);
export type CreatePolicyInput = z.output<typeof createPolicySchema>;

export function createPolicyHandler(
  input: CreatePolicyInput,
  deps: ToolDeps,
): Promise<SuccessEnvelope<Policy> | ErrorEnvelope> {
  return runEdit('create_policy', input.agent_name, async () => {
    const now = new Date().toISOString();
    const policy = await mutateBoardFile(deps.root, input.board_id, (board) => {
      const p: Policy = {
        id: randomUUID(),
        name: input.name,
        description: input.description ?? '',
        type: input.type,
        definition: input.definition,
        priority: input.priority ?? 0,
        enabled: input.enabled ?? true,
        version: 1,
        created_by_agent: input.agent_name,
        created_at: now,
        updated_at: now,
        archived_at: null,
      };
      return {
        result: p,
        next: {
          ...board,
          policies: [...board.policies, p],
          version: board.version + 1,
          updated_at: now,
        },
      };
    });
    return successEnvelope<Policy>({
      entity: 'policy',
      id: policy.id,
      version: policy.version,
      state: policy,
    });
  });
}

export function registerCreatePolicy(server: McpServer, deps: ToolDeps): void {
  server.tool(
    'create_policy',
    'Add a policy to a board (`transition_guard` or `agent_responsibility`). `definition` carries the rule. Requires `agent_name`.',
    createPolicyShape,
    wrapToolHandler('create_policy', createPolicySchema, (input) =>
      createPolicyHandler(input, deps),
    ),
  );
}
