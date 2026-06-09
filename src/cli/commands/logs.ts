import { existsSync } from 'node:fs';
import { substrateRootFromCwd, paths } from '../../shared/paths.js';
import { SubstrateError } from '../../core/errors.js';
import { readRotatedLines, parseEvents } from '../../shared/log-read.js';

/**
 * `substrate logs [-n <N>] [--errors]` — print recent lines from the persistent
 * error log (`.substrate/logs/substrate.log`), reading across a rotation so `-n`
 * is honored (R6). Two distinct empty-states: the log file is ABSENT (the sink
 * never ran — no `mcp`/`serve` has logged) vs. present-but-no-errors (it ran
 * cleanly). Errors are recorded only by the long-lived `mcp`/`serve` processes.
 */
export function logsCommand(cwd: string, opts: { n?: string; errors?: boolean }): void {
  const root = substrateRootFromCwd(cwd);
  if (!existsSync(root)) {
    throw SubstrateError.notFound(`No .substrate/ in ${cwd}. Run 'substrate init' first.`, { cwd });
  }
  const logFile = paths(root).logFile;

  let n = 50;
  if (opts.n !== undefined) {
    const parsed = Number(opts.n);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw SubstrateError.schemaViolation(`-n must be a positive integer, got '${opts.n}'.`, {
        value: opts.n,
      });
    }
    n = parsed;
  }

  if (!existsSync(logFile)) {
    process.stdout.write(
      `No log file yet at ${logFile}. Errors are recorded once a long-lived ` +
        `'substrate mcp' or 'substrate serve' process has logged one.\n`,
    );
    return;
  }

  const lines = readRotatedLines(logFile);

  if (opts.errors) {
    const errorEvents = parseEvents(lines).filter((e) => e.level === 'ERROR');
    if (errorEvents.length === 0) {
      process.stdout.write('no errors in the log\n');
      return;
    }
    for (const e of errorEvents.slice(-n)) {
      process.stdout.write(`${e.header}\n`);
      for (const b of e.body) process.stdout.write(`${b}\n`);
    }
  } else {
    for (const line of lines.slice(-n)) {
      process.stdout.write(`${line}\n`);
    }
  }

  process.stdout.write(`\nLog: ${logFile}\n`);
}
