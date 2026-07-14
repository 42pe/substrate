/**
 * Tiny ANSI color helper for the CLI — no dependency (chalk-free).
 *
 * Every wrapper takes `(s, enabled)` and returns `s` UNCHANGED when
 * `enabled === false`, so a caller decides once (via `colorEnabled()`) and the
 * plain path is byte-identical to piping. `stripAnsi` + the width math in
 * `./table` keep colorized cells aligned. Escapes are raw string literals — the
 * whole point is to avoid a dependency for four SGR codes.
 */

const CSI = '\x1b[';
const RESET = '\x1b[0m';

function wrap(code: string, s: string, enabled: boolean): string {
  return enabled ? `${CSI}${code}m${s}${RESET}` : s;
}

export const bold = (s: string, enabled: boolean): string => wrap('1', s, enabled);
export const dim = (s: string, enabled: boolean): string => wrap('2', s, enabled);
export const cyan = (s: string, enabled: boolean): string => wrap('36', s, enabled);
export const yellow = (s: string, enabled: boolean): string => wrap('33', s, enabled);

/** Matches every CSI SGR sequence (`\x1b[…m`) our wrappers can emit. */
const ANSI_SGR = /\x1b\[[0-9;]*m/g;

/** Strip every SGR escape — used by tests and the visible-width math. */
export function stripAnsi(s: string): string {
  return s.replace(ANSI_SGR, '');
}

/**
 * Color is on ONLY for an interactive TTY without `NO_COLOR`. Piped, redirected
 * or `NO_COLOR`-set output stays plain bytes so it never leaks escapes into a
 * file or a downstream parser.
 */
export function colorEnabled(): boolean {
  return process.stdout.isTTY === true && !process.env.NO_COLOR;
}
