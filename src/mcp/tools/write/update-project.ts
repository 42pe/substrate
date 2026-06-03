import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  successEnvelope,
  type SuccessEnvelope,
  type ErrorEnvelope,
} from '../../../core/envelope.js';
import type { Config } from '../../../core/types.js';
import { mutateConfig } from '../../../substrate/writer.js';
import { wrapToolHandler } from '../../wrapper.js';
import type { ToolDeps } from '../../deps.js';
import { assertVersion, runEdit } from './substrate-edit.js';

/**
 * MCP tool: update_project — edit the implicit single project (`config.json`).
 * OCC on `config.version`. Project creation is not exposed via MCP (init-only).
 */

export const updateProjectShape = {
  version: z.number().int().nonnegative(),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  agent_name: z.string().min(1, 'agent_name is required'),
};
export const updateProjectSchema = z.object(updateProjectShape);
export type UpdateProjectInput = z.output<typeof updateProjectSchema>;

export function updateProjectHandler(
  input: UpdateProjectInput,
  deps: ToolDeps,
): Promise<SuccessEnvelope<Config> | ErrorEnvelope> {
  return runEdit('update_project', input.agent_name, async () => {
    const next = await mutateConfig(deps.root, (config) => {
      assertVersion(config.version, input.version, config.project_id);
      const updated: Config = {
        ...config,
        ...(input.name !== undefined ? { project_name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        version: config.version + 1,
      };
      return { result: updated, next: updated };
    });
    return successEnvelope<Config>({
      entity: 'project',
      id: next.project_id,
      version: next.version,
      state: next,
    });
  });
}

export function registerUpdateProject(server: McpServer, deps: ToolDeps): void {
  server.tool(
    'update_project',
    'Update the project record (name, description). Requires `version` (returns `version_mismatch` if stale) and `agent_name`.',
    updateProjectShape,
    wrapToolHandler('update_project', updateProjectSchema, (input) =>
      updateProjectHandler(input, deps),
    ),
  );
}
