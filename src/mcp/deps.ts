import type { Client } from '@libsql/client';
import type { Config, Substrate } from '../core/types.js';

/**
 * Dependencies injected into every MCP tool handler.
 *
 * Constructed once by the CLI command that starts the MCP server (e.g.
 * `substrate mcp`) and threaded through to tool registrations. Tools never
 * import these globally — keeps them pure / testable.
 *
 * Phase 1 needed only `client` (libsql) and `config` (project metadata).
 * Phase 2 adds `loadSubstrate` — a thunk that reads `boards/*.json` fresh on
 * each call (substrate-as-code can change under a long-lived process; no
 * caching in v1). Phase 3 will add the policy engine. Extend narrowly.
 */
export interface ToolDeps {
  client: Client;
  config: Config;
  /** Reads the whole substrate (config + boards) fresh from disk. */
  loadSubstrate: () => Promise<Substrate>;
}
