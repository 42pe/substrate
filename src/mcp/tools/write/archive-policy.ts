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
import { wrapToolHandler } from '../../wrapper.js';
import type { ToolDeps } from '../../deps.js';
import { assertVersion, runEdit } from './substrate-edit.js';

/** MCP tool: archive_policy — soft-delete a policy. Idempotent. */

export const archivePolicyShape = {
  id: z.string().min(1, 'id is required'),
  version: z.number().int().nonnegative(),
  agent_name: z.string().min(1, 'agent_name is required'),
};
export const archivePolicySchema = z.object(archivePolicyShape);
export type ArchivePolicyInput = z.output<typeof archivePolicySchema>;

function notFound(id: string): SubstrateError {
  return SubstrateError.notFound(`Policy '${id}' not found in any board.`, {
    entity: 'policy',
    id,
  });
}

export function archivePolicyHandler(
  input: ArchivePolicyInput,
  deps: ToolDeps,
): Promise<SuccessEnvelope<Policy> | ErrorEnvelope> {
  return runEdit('archive_policy', input.agent_name, async () => {
    const substrate = await deps.loadSubstrate();
    const board = findBoardHolding(substrate, input.id, 'policy');
    if (!board) throw notFound(input.id);

    const now = new Date().toISOString();
    const policy = await mutateBoardFile(deps.root, board.id, (b) => {
      const idx = b.policies.findIndex((p) => p.id === input.id);
      if (idx === -1) throw notFound(input.id);
      const p = b.policies[idx]!;
      if (p.archived_at !== null) return { result: p, next: b }; // idempotent no-op
      assertVersion(p.version, input.version, p.id);
      const archived: Policy = { ...p, archived_at: now, version: p.version + 1, updated_at: now };
      const policies = [...b.policies];
      policies[idx] = archived;
      return {
        result: archived,
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

export function registerArchivePolicy(server: McpServer, deps: ToolDeps): void {
  server.tool(
    'archive_policy',
    'Soft-delete a policy. Idempotent. Requires `version` and `agent_name`.',
    archivePolicyShape,
    wrapToolHandler('archive_policy', archivePolicySchema, (input) =>
      archivePolicyHandler(input, deps),
    ),
  );
}
