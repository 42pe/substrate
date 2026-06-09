import { existsSync, readFileSync } from 'node:fs';

/**
 * Reading helpers for the persistent error log (Phase 7b), shared by
 * `substrate logs` and `substrate diagnose`.
 *
 * A log line is a HEADER when it matches `HEADER_RE` (`<ISO> <LEVEL> …`). An
 * unexpected error's stack is written as indented lines AFTER its header; the
 * reader delimits a stack block by anchoring on the NEXT header, not by
 * "indented" (under concurrent appends, indentation alone is unreliable —
 * CONCERN-2b).
 */
export const HEADER_RE = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z (INFO|WARN|ERROR) /;

export interface LogEvent {
  /** The header line itself. */
  header: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  /** Following non-header lines (the stack block), up to the next header. */
  body: string[];
}

function toLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop(); // trailing newline
  return lines;
}

/**
 * Read the rotated sibling (`.1`) THEN the current file, oldest-first, as lines
 * (bounded at ~2× the cap). Missing files contribute nothing. Used by
 * `substrate logs` so `-n` can be satisfied across a rotation (R6).
 */
export function readRotatedLines(logFile: string): string[] {
  let text = '';
  const prev = `${logFile}.1`;
  if (existsSync(prev)) text += readFileSync(prev, 'utf-8');
  if (existsSync(logFile)) text += readFileSync(logFile, 'utf-8');
  return toLines(text);
}

/** Read only the current log file as lines (no rotation). Used by diagnose. */
export function readCurrentLines(logFile: string): string[] {
  if (!existsSync(logFile)) return [];
  return toLines(readFileSync(logFile, 'utf-8'));
}

/**
 * Group lines into events: each header starts an event; following non-header
 * lines are its body (the stack block), anchored on the next header. Lines
 * before the first header are dropped.
 */
export function parseEvents(lines: string[]): LogEvent[] {
  const events: LogEvent[] = [];
  for (const line of lines) {
    const m = HEADER_RE.exec(line);
    if (m) {
      events.push({ header: line, level: m[1] as LogEvent['level'], body: [] });
    } else if (events.length > 0) {
      events[events.length - 1]!.body.push(line);
    }
  }
  return events;
}
