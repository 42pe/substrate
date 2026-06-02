import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { wrapToolHandler } from '../../wrapper.js';
import type { ToolDeps } from '../../deps.js';

/**
 * MCP tool: get_project — the full project record.
 *
 * In the local-first model the "project" is the implicit singleton in
 * `.substrate/config.json`. There's no separate description/version yet, so
 * this returns the config fields. Kept distinct from `whoami` (which adds
 * board summaries + hints) so an agent that only needs project metadata pays
 * nothing for a substrate read.
 */

export interface ProjectResult {
  project_id: string;
  project_name: string;
  description: string;
  version: number;
  schema_version: number;
  created_at: string;
}

export function getProjectHandler(deps: ToolDeps): ProjectResult {
  return {
    project_id: deps.config.project_id,
    project_name: deps.config.project_name,
    description: deps.config.description,
    version: deps.config.version,
    schema_version: deps.config.schema_version,
    created_at: deps.config.created_at,
  };
}

export const getProjectShape = {};
const getProjectSchema = z.object(getProjectShape);

export function registerGetProject(server: McpServer, deps: ToolDeps): void {
  server.tool(
    'get_project',
    'Fetch the full project record (name, description, version). Cheap; call after `whoami` if you need fields beyond the summary.',
    getProjectShape,
    wrapToolHandler('get_project', getProjectSchema, () =>
      Promise.resolve(getProjectHandler(deps)),
    ),
  );
}
