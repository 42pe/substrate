/**
 * Pure CLI argument helpers. Kept in their own module (no `main()` side
 * effect) so they're unit-testable. `index.ts` imports them.
 */

const ALLOWED_FLAGS_BY_COMMAND: Record<string, ReadonlySet<string>> = {
  init: new Set(['--no-starter-board', '--template']),
  serve: new Set(),
  mcp: new Set(),
  backup: new Set(),
  export: new Set(),
  import: new Set(['--force']),
  diagnose: new Set(),
  explain: new Set(['--out']),
  logs: new Set(['-n', '--errors']),
  add: new Set(['--yes', '--as']),
  approve: new Set(),
  validate: new Set(),
};

/**
 * Exit with a clear error if `argv` carries a flag the command doesn't allow.
 * Compares the flag HEAD (`--out` of `--out=x.html`), not the whole token, so
 * the `=value` form isn't rejected before its value is extracted.
 */
export function rejectUnknownFlags(cmd: string, argv: string[]): void {
  const allowed = ALLOWED_FLAGS_BY_COMMAND[cmd];
  if (!allowed) return; // commands with no allowlist defined are validated elsewhere
  for (const arg of argv) {
    if (!arg.startsWith('-')) continue; // positional, not a flag
    const head = arg.split('=')[0]!;
    if (!allowed.has(head)) {
      const supportedLabel =
        allowed.size === 0 ? '(no flags supported)' : `[${[...allowed].join(', ')}]`;
      process.stderr.write(`Unknown flag for '${cmd}': ${arg}\nSupported: ${supportedLabel}\n`);
      process.exit(1);
    }
  }
}

/**
 * Extract a value-taking flag (`--flag value` OR `--flag=value`) from argv.
 * Returns the value (or undefined if the flag is absent) and the residual argv
 * with the flag AND its space-form value removed — so `rejectUnknownFlags`
 * never sees the value token as a stray flag, and a flag-shaped value can't
 * misfire it. A flag present with no value exits with a clear error.
 */
export function extractFlagValue(
  argv: string[],
  flag: string,
): { value: string | undefined; rest: string[] } {
  const rest: string[] = [];
  let value: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === flag) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('-')) {
        process.stderr.write(`${flag} requires a value: ${flag} <value>\n`);
        process.exit(1);
      }
      value = next;
      i++; // consume the value token so it isn't re-examined as a flag
      continue;
    }
    if (a.startsWith(`${flag}=`)) {
      const v = a.slice(flag.length + 1);
      if (v === '') {
        process.stderr.write(`${flag} requires a value: ${flag} <value>\n`);
        process.exit(1);
      }
      value = v;
      continue;
    }
    rest.push(a);
  }
  return { value, rest };
}
