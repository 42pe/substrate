import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerAllTools } from './registry.js';
import type { ToolDeps } from './deps.js';

/**
 * Build a configured MCP server with all Phase 1 tools registered.
 * Useful in tests that exercise the registration layer without spinning up
 * an actual stdio transport.
 */
export function buildServer(deps: ToolDeps): McpServer {
  const server = new McpServer({
    name: 'substrate',
    version: '0.0.1',
  });
  registerAllTools(server, deps);
  return server;
}

/**
 * Start the MCP server on a stdio transport. Runs until stdin closes
 * (typically when the agent runtime disconnects).
 *
 * The caller (`substrate mcp` CLI command) is responsible for closing
 * `deps.client` after this returns.
 */
export async function startStdioServer(deps: ToolDeps): Promise<void> {
  const server = buildServer(deps);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  await new Promise<void>((resolve) => {
    process.stdin.once('close', resolve);
    process.stdin.once('end', resolve);
  });
}
