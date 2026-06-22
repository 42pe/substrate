import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  successEnvelope,
  type SuccessEnvelope,
  type ErrorEnvelope,
} from '../../../core/envelope.js';
import type { Policy } from '../../../core/types.js';
import { SubstrateError } from '../../../core/errors.js';
import { mutateBoardFile } from '../../../substrate/writer.js';
import { validatePolicyDefinition } from '../../../policy/definition-schema.js';
import { wrapToolHandler } from '../../wrapper.js';
import type { ToolDeps } from '../../deps.js';
import { runEdit } from './substrate-edit.js';

/**
 * MCP tool: create_policy — append a policy to a board. `definition` is
 * validated against `type` (a malformed guard/responsibility is rejected with
 * `schema_violation` rather than silently never engaging). No version param
 * (LWW). `not_found` if the board doesn't exist.
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
    validatePolicyDefinition(input.type, input.definition, SubstrateError.schemaViolation);
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
    [
      'Add a policy to a board. `definition` is validated against `type`:',
      '• transition_guard → { from_group, to_group, require?: Condition[], on_failure_message?: string } — BLOCKS a matching group move unless every `require` condition passes. from_group/to_group are group ids, or "*" for any.',
      '• agent_responsibility → { when?: Condition[], message: string } — never blocks; attaches `message` as a suggestion in the write envelope when `when` matches (empty `when` = always).',
      'Condition = { field, op, value?, values? } or { all_of | any_of | none_of: Condition[] }. op ∈ exists, not_exists, is_empty, not_empty, eq, neq, in, not_in, gt, gte, lt, lte, contains, not_contains, starts_with, ends_with, matches_regex, matches_any_keyword, has_any, has_all (value for scalars, values for set/array ops).',
      'Fields resolve literal-then-custom_data, so a gate field is `task.<name>` (e.g. task.tests_passing). Requires `agent_name`.',
    ].join('\n'),
    createPolicyShape,
    wrapToolHandler('create_policy', createPolicySchema, (input) =>
      createPolicyHandler(input, deps),
    ),
  );
}
