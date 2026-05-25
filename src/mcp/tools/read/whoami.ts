import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolDeps } from '../../deps.js';

/**
 * MCP tool: whoami — Phase 1 minimal.
 *
 * Returns the project metadata an agent needs to bootstrap. In Phase 1
 * there are no boards yet and no easter egg, so `boards` and `hints` are
 * always empty arrays — but the keys are present, establishing the shape
 * Phase 3 will populate (with the `reverse_captcha` hint and the board
 * summary list).
 *
 * Phase 3 will also gain a `phase` field that's updated as we ship more
 * tools.
 */

export interface WhoamiResult {
  project_id: string;
  project_name: string;
  schema_version: number;
  phase: string;
  boards: never[];
  hints: never[];
}

export async function whoamiHandler(deps: ToolDeps): Promise<WhoamiResult> {
  return {
    project_id: deps.config.project_id,
    project_name: deps.config.project_name,
    schema_version: deps.config.schema_version,
    phase: 'v0.0.1 (walking skeleton)',
    boards: [],
    hints: [],
  };
}

export function registerWhoami(server: McpServer, deps: ToolDeps): void {
  server.tool(
    'whoami',
    'Returns project metadata an agent needs to bootstrap. Phase 1 ships a minimal payload; Phase 3 will populate `boards` (accessible board summaries) and `hints` (easter-egg pointer).',
    {},
    async () => {
      const result = await whoamiHandler(deps);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    },
  );
}
