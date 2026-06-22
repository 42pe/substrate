import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SubstrateError } from '../../../core/errors.js';
import {
  successEnvelope,
  type SuccessEnvelope,
  type ErrorEnvelope,
} from '../../../core/envelope.js';
import type { Policy } from '../../../core/types.js';
import { mutateBoardFile, findBoardHolding } from '../../../substrate/writer.js';
import { validatePolicyDefinition } from '../../../policy/definition-schema.js';
import { wrapToolHandler } from '../../wrapper.js';
import type { ToolDeps } from '../../deps.js';
import { assertVersion, runEdit } from './substrate-edit.js';

/**
 * MCP tool: update_policy — patch a policy. OCC on policy.version. `type` is
 * IMMUTABLE: sending a differing `type` is rejected with `schema_violation`
 * (N2). `definition` is stored as-is.
 */

export const updatePolicyShape = {
  id: z.string().min(1, 'id is required'),
  version: z.number().int().nonnegative(),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  type: z.enum(['transition_guard', 'agent_responsibility']).optional(),
  definition: z.record(z.string(), z.unknown()).optional(),
  priority: z.number().int().optional(),
  enabled: z.boolean().optional(),
  agent_name: z.string().min(1, 'agent_name is required'),
};
export const updatePolicySchema = z.object(updatePolicyShape);
export type UpdatePolicyInput = z.output<typeof updatePolicySchema>;

function notFound(id: string): SubstrateError {
  return SubstrateError.notFound(`Policy '${id}' not found in any board.`, {
    entity: 'policy',
    id,
  });
}

export function updatePolicyHandler(
  input: UpdatePolicyInput,
  deps: ToolDeps,
): Promise<SuccessEnvelope<Policy> | ErrorEnvelope> {
  return runEdit('update_policy', input.agent_name, async () => {
    const substrate = await deps.loadSubstrate();
    const board = findBoardHolding(substrate, input.id, 'policy');
    if (!board) throw notFound(input.id);

    const now = new Date().toISOString();
    const policy = await mutateBoardFile(deps.root, board.id, (b) => {
      const idx = b.policies.findIndex((p) => p.id === input.id);
      if (idx === -1) throw notFound(input.id);
      const p = b.policies[idx]!;
      assertVersion(p.version, input.version, p.id);
      if (input.type !== undefined && input.type !== p.type) {
        throw SubstrateError.schemaViolation(
          `Policy 'type' is immutable (current '${p.type}'). Create a new policy instead.`,
          { id: p.id, current: p.type, requested: input.type },
        );
      }
      // A replacement `definition` is validated against the policy's (immutable)
      // type, so an edit can't turn a working gate into a silent no-op.
      if (input.definition !== undefined) {
        validatePolicyDefinition(p.type, input.definition, SubstrateError.schemaViolation);
      }
      const updated: Policy = {
        ...p,
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.definition !== undefined ? { definition: input.definition } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        version: p.version + 1,
        updated_at: now,
      };
      const policies = [...b.policies];
      policies[idx] = updated;
      return {
        result: updated,
        next: { ...b, policies, version: b.version + 1, updated_at: now },
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

export function registerUpdatePolicy(server: McpServer, deps: ToolDeps): void {
  server.tool(
    'update_policy',
    'Update a policy (name, description, definition, priority, enabled). `type` is immutable. A replacement `definition` is validated against the policy type (same shape as `create_policy`). Requires `version` and `agent_name`.',
    updatePolicyShape,
    wrapToolHandler('update_policy', updatePolicySchema, (input) =>
      updatePolicyHandler(input, deps),
    ),
  );
}
