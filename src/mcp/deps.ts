import type { Client } from '@libsql/client';
import type { Config } from '../core/types.js';

/**
 * Dependencies injected into every MCP tool handler.
 *
 * Constructed once by the CLI command that starts the MCP server (e.g.
 * `substrate mcp`) and threaded through to tool registrations. Tools never
 * import these globally — keeps them pure / testable.
 *
 * Phase 1 needs only `client` (libsql) and `config` (project metadata).
 * Phase 2 will likely add a substrate loader; Phase 3 will add the policy
 * engine. Extend this interface narrowly as those phases land.
 */
export interface ToolDeps {
  client: Client;
  config: Config;
}
