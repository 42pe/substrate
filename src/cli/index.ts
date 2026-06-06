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
import { explainCommand } from './commands/explain.js';
import { rejectUnknownFlags, extractFlagValue } from './args.js';
import { SubstrateError } from '../core/errors.js';
import { BINARY_VERSION } from '../core/version.js';

const HELP = `Substrate v${BINARY_VERSION} — local-first agent-collaborative substrate

Usage:
  substrate init              Initialize a new (blank) .substrate/ in the current directory
  substrate init --template <name>
                              Initialize with a starter board (templates: web-delivery)
  substrate serve             Start the HTTP UI server (default: http://localhost:7475)
  substrate mcp               Start the stdio MCP server (spawned by agent runtimes)
  substrate backup            Write a timestamped backup into .substrate/backups/
  substrate export <path>     Write a .tar.gz of the substrate to <path>
  substrate import <path>     Restore a substrate archive (--force to overwrite)
  substrate diagnose          Print environment + substrate health
  substrate explain [--out <file>]
                              Write a self-contained HTML map of the substrate
                              (default: ./substrate-explain.html)
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
    case 'init': {
      const { value: template, rest: initRest } = extractFlagValue(rest, '--template');
      rejectUnknownFlags('init', initRest);
      await initCommand(cwd, template !== undefined ? { template } : {});
      const boardLine =
        template !== undefined ? `\nStarter board 'delivery' added (template: ${template}).` : '';
      const firstStep =
        template !== undefined
          ? 'Review the starter board: .substrate/boards/delivery.json'
          : 'Add a board: edit .substrate/boards/<your-board>.json (or ask an agent via MCP)';
      process.stdout.write(`Substrate initialized in ${cwd}/.substrate${boardLine}

Next steps:
  1. ${firstStep}
  2. Start the substrate UI:  npx @diegoferreyra/substrate serve
  3. Configure your agent runtime to spawn:  npx @diegoferreyra/substrate mcp
`);
      return;
    }
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
    case 'explain': {
      const { value: out, rest: explainRest } = extractFlagValue(rest, '--out');
      rejectUnknownFlags('explain', explainRest);
      await explainCommand(cwd, out !== undefined ? { out } : {});
      return;
    }
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
