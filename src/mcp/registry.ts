import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerCreateTask } from './tools/write/create-task.js';
import { registerWhoami } from './tools/read/whoami.js';
import type { ToolDeps } from './deps.js';

/**
 * Single place that lists Phase 1's MCP tools. New tools land here as
 * later phases ship them (Phase 2: full read/write singletons; Phase 3:
 * adds `reverse_captcha` stub; Phase 4: substrate-edit tools; Phase 6:
 * full `reverse_captcha`).
 *
 * The order of registration is the order tools appear in `tools/list`.
 */
export function registerAllTools(server: McpServer, deps: ToolDeps): void {
  // Read tools
  registerWhoami(server, deps);

  // Write tools (singletons)
  registerCreateTask(server, deps);
}
