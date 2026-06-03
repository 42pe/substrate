/**
 * Substrate CLI entry point.
 *
 * Note on shebang: tsc does not preserve `#!/usr/bin/env node` from source.
 * The shebang is added to `dist/server/cli/index.js` by `scripts/post-build.mjs`
 * after `tsc -p tsconfig.build.json`, which also chmods +x. tsx (dev runner)
 * does not need a shebang because it's invoked as `tsx src/cli/index.ts`.
 *
 * Subcommands:
 *   substrate                (no args) → serve (alias)
 *   substrate init           Initialize .substrate/ in the cwd
 *   substrate serve          Start the HTTP UI server
 *   substrate mcp            Start the stdio MCP server (for agent runtimes)
 *   substrate backup         Write a timestamped backup into .substrate/backups/
 *   substrate export <path>  Write a .tar.gz of the substrate to <path>
 *   substrate import <path>  Restore a substrate archive (--force to overwrite)
 *   substrate diagnose       Print environment + substrate health
 *   substrate --help         Show help
 */
import { initCommand } from './commands/init.js';
import { serveCommand } from './commands/serve.js';
import { mcpCommand } from './commands/mcp.js';
import { backupCommand } from './commands/backup.js';
import { exportCommand } from './commands/export.js';
import { importCommand } from './commands/import.js';
import { diagnoseCommand } from './commands/diagnose.js';
import { SubstrateError } from '../core/errors.js';
import { BINARY_VERSION } from '../core/version.js';

const HELP = `Substrate v${BINARY_VERSION} — local-first agent-collaborative substrate

Usage:
  substrate init              Initialize a new .substrate/ in the current directory
  substrate serve             Start the HTTP UI server (default: http://localhost:7475)
  substrate mcp               Start the stdio MCP server (spawned by agent runtimes)
  substrate backup            Write a timestamped backup into .substrate/backups/
  substrate export <path>     Write a .tar.gz of the substrate to <path>
  substrate import <path>     Restore a substrate archive (--force to overwrite)
  substrate diagnose          Print environment + substrate health
  substrate --help            Show this help

After running 'init', add Substrate to your agent runtime's MCP config:
  {
    "mcpServers": {
      "substrate": {
        "command": "npx",
        "args": ["@diegoferreyra/substrate", "mcp"]
      }
    }
  }
`;

/**
 * Allowed flags per subcommand. Phase 1 has no flags that actually do
 * anything — `--no-starter-board` is reserved per spec §3.2 and accepted
 * as a no-op so users can experiment with the eventual API shape without
 * a surprise rejection. Unknown flags are rejected loudly. Reviewer S-2 fix.
 */
const ALLOWED_FLAGS_BY_COMMAND: Record<string, ReadonlySet<string>> = {
  init: new Set(['--no-starter-board']),
  serve: new Set(),
  mcp: new Set(),
  backup: new Set(),
  export: new Set(),
  import: new Set(['--force']),
  diagnose: new Set(),
};

function rejectUnknownFlags(cmd: string, argv: string[]): void {
  const allowed = ALLOWED_FLAGS_BY_COMMAND[cmd];
  if (!allowed) return; // commands with no allowlist defined are validated elsewhere
  for (const arg of argv) {
    if (!arg.startsWith('-')) continue; // positional, not a flag
    if (!allowed.has(arg)) {
      const supportedLabel =
        allowed.size === 0 ? '(no flags supported)' : `[${[...allowed].join(', ')}]`;
      process.stderr.write(`Unknown flag for '${cmd}': ${arg}\nSupported: ${supportedLabel}\n`);
      process.exit(1);
    }
  }
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  const rest = process.argv.slice(3);
  const cwd = process.cwd();

  switch (cmd) {
    case undefined:
    case 'serve':
      rejectUnknownFlags('serve', rest);
      await serveCommand(cwd);
      return;
    case 'init':
      rejectUnknownFlags('init', rest);
      await initCommand(cwd);
      process.stdout.write(`Substrate initialized in ${cwd}/.substrate

Next steps:
  1. Add a board: edit .substrate/boards/<your-board>.json (or ask an agent via MCP)
  2. Start the substrate UI:  npx @diegoferreyra/substrate serve
  3. Configure your agent runtime to spawn:  npx @diegoferreyra/substrate mcp
`);
      return;
    case 'mcp':
      rejectUnknownFlags('mcp', rest);
      await mcpCommand(cwd);
      return;
    case 'backup':
      rejectUnknownFlags('backup', rest);
      await backupCommand(cwd);
      return;
    case 'export':
      rejectUnknownFlags('export', rest);
      await exportCommand(
        cwd,
        rest.find((a) => !a.startsWith('-')),
      );
      return;
    case 'import':
      rejectUnknownFlags('import', rest);
      await importCommand(
        cwd,
        rest.find((a) => !a.startsWith('-')),
        rest.includes('--force'),
      );
      return;
    case 'diagnose':
      rejectUnknownFlags('diagnose', rest);
      await diagnoseCommand(cwd);
      return;
    case '--help':
    case '-h':
    case 'help':
      process.stdout.write(HELP);
      return;
    default:
      process.stderr.write(`Unknown command: ${cmd}\n\n${HELP}`);
      process.exit(1);
  }
}

main().catch((err) => {
  if (SubstrateError.is(err)) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
  process.stderr.write(`Unexpected error: ${(err as Error).message}\n`);
  // Print stack for unknown errors (debug-friendly during Phase 1)
  if ((err as Error).stack) {
    process.stderr.write(`${(err as Error).stack}\n`);
  }
  process.exit(2);
});
