import { existsSync } from 'node:fs';
import { paths, substrateRootFromCwd } from '../../shared/paths.js';
import { readConfig } from '../../shared/config.js';
import { openDatabaseAndMigrate } from '../../storage/client.js';
import { startStdioServer } from '../../mcp/server.js';
import { loadSubstrate } from '../../substrate/loader.js';
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
 *      Note: schema-version refuse-to-open lives inside `runMigrations`;
 *      a future swap to plain `openClient` would silently regress it.
 *      Reviewer S-8 note.
 *   3. Start the MCP server on stdio. Returns when stdin closes.
 *   4. Close the database in `finally` AND on `beforeExit` (defense in
 *      depth — the SDK could throw out-of-band in a way `startStdioServer`
 *      doesn't surface). Reviewer C-5 fix.
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

  // Defense in depth: close the DB on any teardown path, including
  // uncaught exceptions inside the SDK that bypass our try/finally below.
  let closedAlready = false;
  const safeClose = (): void => {
    if (closedAlready) return;
    closedAlready = true;
    try {
      client.close();
    } catch {
      // best-effort
    }
  };
  process.once('beforeExit', safeClose);

  try {
    await startStdioServer({ client, config, loadSubstrate: () => loadSubstrate(root) });
  } finally {
    safeClose();
  }
}
