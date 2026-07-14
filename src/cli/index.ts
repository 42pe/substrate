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
import { logsCommand } from './commands/logs.js';
import { addCommand } from './commands/add.js';
import { approveCommand } from './commands/approve.js';
import { validateCommand } from './commands/validate.js';
import { pendingApprovalCommand } from './commands/pending-approval.js';
import { installSkillCommand } from './commands/install-skill.js';
import { rejectUnknownFlags, extractFlagValue } from './args.js';
import { SubstrateError } from '../core/errors.js';
import { BINARY_VERSION } from '../core/version.js';

const HELP = `Substrate v${BINARY_VERSION} — local-first agent-collaborative substrate

Usage:
  substrate init              Initialize a new (blank) .substrate/ in the current directory
  substrate init --template <name-or-path>
                              Initialize with a starter board: a bundled template
                              (web-delivery) OR a local template directory
  substrate add <path> [--yes] [--as <id>]
                              Apply a shared substrate template into an existing
                              .substrate/ (dry-run unless --yes). <path> is a local
                              dir — your agent clones the repo first.
  substrate serve             Start the HTTP UI server (default: http://localhost:7475;
                              if 7475 is taken it scans 7475–7499 for a free port)
  substrate mcp               Start the stdio MCP server (spawned by agent runtimes)
  substrate backup            Write a timestamped backup into .substrate/backups/
  substrate export <path>     Write a .tar.gz of the substrate to <path>
  substrate import <path>     Restore a substrate archive (--force to overwrite)
  substrate diagnose          Print environment + substrate health
  substrate explain [--out <file>]
                              Write a self-contained HTML map of the substrate
                              (default: ./substrate-explain.html)
  substrate logs [-n <N>] [--errors]
                              Print recent log lines (default last 50;
                              --errors filters to errors) — useful for bug reports
  substrate approve <task_id> <field> [value=true]
                              Set a human-only field on a task, stamped as the
                              current OS user (the human channel agents can't use)
  substrate validate          Lint boards + policies without a server (CI-friendly):
                              a corrupt substrate exits non-zero; logical smells
                              (a guard that can never fire) print advisory warnings
  substrate pending-approval  List every task awaiting a human approval (a move
                              gated on an unset human-only field), grouped by board
  substrate install-skill [--check]
                              Refresh the installed agent skill (~/.claude/skills/substrate)
                              from the copy packaged in this binary, version-stamped and
                              idempotent. --check reports drift and exits non-zero without
                              writing (for CI / diagnose).
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
      const { boardIds } = await initCommand(cwd, template !== undefined ? { template } : {});
      // Unified id-list message for BOTH bundled and path templates (C6); bare
      // init prints no board line.
      const boardLine =
        boardIds.length > 0 ? `\nStarter boards added (${template}): ${boardIds.join(', ')}.` : '';
      const firstStep =
        boardIds.length > 0
          ? `Review the starter board(s): ${boardIds.map((id) => `.substrate/boards/${id}.json`).join(', ')}`
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
    case 'logs': {
      const { value: n, rest: logsRest } = extractFlagValue(rest, '-n');
      const errors = logsRest.includes('--errors');
      rejectUnknownFlags('logs', logsRest);
      logsCommand(cwd, { ...(n !== undefined ? { n } : {}), errors });
      return;
    }
    case 'add': {
      // C5 arg order: extract --as FIRST (its value can't be mistaken for the
      // positional), then take the positional from the residual, then reject.
      const { value: as, rest: addRest } = extractFlagValue(rest, '--as');
      const path = addRest.find((a) => !a.startsWith('-'));
      if (path === undefined) {
        process.stderr.write('Usage: substrate add <path> [--yes] [--as <id>]\n');
        process.exit(1);
      }
      rejectUnknownFlags('add', addRest);
      await addCommand(cwd, path, {
        yes: addRest.includes('--yes'),
        ...(as !== undefined ? { as } : {}),
      });
      return;
    }
    case 'approve': {
      rejectUnknownFlags('approve', rest);
      const positionals = rest.filter((a) => !a.startsWith('-'));
      const [taskId, field, value] = positionals;
      if (taskId === undefined || field === undefined) {
        process.stderr.write('Usage: substrate approve <task_id> <field> [value=true]\n');
        process.exit(1);
      }
      await approveCommand(cwd, { taskId, field, ...(value !== undefined ? { value } : {}) });
      return;
    }
    case 'validate':
      rejectUnknownFlags('validate', rest);
      await validateCommand(cwd);
      return;
    case 'pending-approval':
      rejectUnknownFlags('pending-approval', rest);
      await pendingApprovalCommand(cwd);
      return;
    case 'install-skill':
      rejectUnknownFlags('install-skill', rest);
      await installSkillCommand({ check: rest.includes('--check') });
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
