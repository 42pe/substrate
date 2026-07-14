/**
 * Pure text-layout helpers for aligned CLI tables — no dependency.
 *
 * Width is measured on the VISIBLE string (ANSI escapes excluded) so a
 * colorized cell still lines up with a plain one. ASCII/BMP width only: a code
 * unit counts as one column, so wide CJK or emoji can still misalign — accepted
 * for v1 to keep this dependency-free (see the plan's risk note).
 */
import { stripAnsi } from './color.js';

export const ELLIPSIS = '…';

/** Visible (printable) width of a possibly-colorized string. */
export function visibleWidth(s: string): number {
  return stripAnsi(s).length;
}

/**
 * Clamp a PLAIN string to at most `max` visible chars, marking any cut with a
 * trailing ellipsis. `max <= 0` yields the empty string; `max === 1` yields the
 * lone ellipsis.
 */
export function truncate(s: string, max: number): string {
  if (max <= 0) return '';
  if (s.length <= max) return s;
  if (max === 1) return ELLIPSIS;
  return s.slice(0, max - 1) + ELLIPSIS;
}

/**
 * Right-pad `s` with spaces to `width`, measured by VISIBLE width so trailing
 * color escapes never inflate the count. Already-wide strings pass through.
 */
export function padEnd(s: string, width: number): string {
  const pad = width - visibleWidth(s);
  return pad > 0 ? s + ' '.repeat(pad) : s;
}

/**
 * Pick the width of the single flexible column so a row fits `total`.
 *
 * `fixed` is the summed visible width of every other column plus the gaps and
 * indent between them. The flexible column takes its `natural` width when it
 * fits; otherwise it shrinks toward `floor` (its content truncated by the
 * caller) but never below `floor` and never above `natural`. When even `floor`
 * overflows (e.g. a long verbatim command in a later column), `floor` is
 * returned and the row is allowed to exceed `total` — correctness of that
 * column beats fitting the width.
 */
export function flexWidth(natural: number, fixed: number, total: number, floor: number): number {
  const budget = total - fixed;
  if (natural <= budget) return natural;
  // Must shrink: clamp to [floor, natural] — never above natural (don't pad short
  // content out to the floor) and never below floor (row overflows instead).
  return Math.min(natural, Math.max(floor, budget));
}
