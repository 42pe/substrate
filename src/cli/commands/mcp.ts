import { existsSync } from 'node:fs';
import { paths, substrateRootFromCwd } from '../../shared/paths.js';
import { readConfig } from '../../shared/config.js';
import { openDatabaseAndMigrate } from '../../storage/client.js';
import { startStdioServer } from '../../mcp/server.js';
import { SubstrateError } from '../../core/errors.js';

/**
 * `npx substrate mcp` — start the stdio MCP server.
 *
 * Spawned by an agent runtime (Claude Code, MCP Inspector, etc.) via the
 * runtime's `.mcp.json` config. NEVER run manually for normal use — the
 * agent runtime owns the child lifecycle.
 *
 * Behavior:
 *   1. Refuse if `.substrate/` is missing.
 *   2. Open the database (runs migrations, verifies schema version).
 *   3. Start the MCP server on stdio. Returns when stdin closes.
 *   4. Close the database before exit.
 *
 * Does NOT write a PID file — multiple stdio MCP children co-exist by
 * design (one per agent session).
 */
export async function mcpCommand(cwd: string): Promise<void> {
  const root = substrateRootFromCwd(cwd);
  if (!existsSync(root)) {
    throw SubstrateError.notFound(`No .substrate/ in ${cwd}. Run 'substrate init' first.`, { cwd });
  }

  const p = paths(root);
  const config = await readConfig(root);
  const client = await openDatabaseAndMigrate(p.dataSqlite);

  try {
    await startStdioServer({ client, config });
  } finally {
    client.close();
  }
}
