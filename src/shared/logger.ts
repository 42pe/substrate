import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Minimal logger for v1. Wraps console; sanitizes `agent_name` from context.
 *
 * The `agent_name` value on writes is treated as untrusted input (workflow.md
 * §Instrumentation): we never reflect it unsanitized into terminal output,
 * since control chars / newlines could be used for log injection.
 *
 * Phase 7b adds an OPTIONAL persistent file sink (`.substrate/logs/substrate.log`).
 * `warn`/`error` ALSO append to it when a sink has been configured (only the
 * long-lived `mcp`/`serve` processes configure it). `info` stays console-only.
 * Because the file is the user's own gitignored machine, it may carry full
 * internal detail — including the STACK for unexpected errors (via the reserved
 * `err` context key) — while the stdio/HTTP boundary still returns the generic
 * scrubbed envelope. `buildSafeContext` strips `err` from every serialized
 * context, so the stack reaches ONLY the file's rendered stack block.
 *
 * Structured logging (pino, etc.) deferred to v1.x.
 */
export type LogLevel = 'info' | 'warn' | 'error';

export interface LogContext {
  agent_name?: string;
  /**
   * RESERVED key. The raw `Error` for an unexpected failure — the file sink
   * reads its `.stack` for the rendered stack block. `buildSafeContext` deletes
   * it from every serialized context (console line AND file context JSON), so
   * the stack never crosses the stdio/HTTP boundary. DO NOT put real data here.
   */
  err?: unknown;
  [key: string]: unknown;
}

/** On-disk cap before single-generation rotation (`substrate.log.1`). */
export const LOG_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Sanitize an agent-supplied identity tag for safe terminal output:
 *   - strip ASCII control chars (\x00-\x1f) and DEL (\x7f)
 *   - truncate to 100 chars
 *   - surround with brackets so it's visually distinct from log structure
 */
export function sanitizeAgentName(name: string): string {
  const cleaned = name.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 100);
  return `[${cleaned}]`;
}

/**
 * The single safe-serialization path for context (CONCERN-3): sanitize
 * `agent_name` and DELETE the reserved `err` key. Both the console `format()`
 * and the file `formatForFile()` build their serialized context through this,
 * so the `agent_name` rule is written once and `err` is provably excluded from
 * every JSON-serialized context.
 */
function buildSafeContext(ctx: LogContext): Record<string, unknown> {
  const safe: Record<string, unknown> = { ...ctx };
  if (typeof safe.agent_name === 'string') {
    safe.agent_name = sanitizeAgentName(safe.agent_name);
  }
  delete safe.err;
  return safe;
}

function format(level: LogLevel, msg: string, ctx?: LogContext): string {
  const ts = new Date().toISOString();
  if (!ctx) {
    return `${ts} ${level.toUpperCase()} ${msg}`;
  }
  return `${ts} ${level.toUpperCase()} ${msg} ${JSON.stringify(buildSafeContext(ctx))}`;
}

/**
 * Compose the WHOLE file event in memory (one write per event, CONCERN-2a): the
 * same header line as the console, PLUS — when the raw `ctx.err` is an `Error`
 * with a stack — an indented stack block read DIRECTLY from the raw context
 * (never the safe one). The indentation keeps stack lines from matching the
 * `^<ISO> (INFO|WARN|ERROR) ` header anchor the reader uses (§3.7).
 */
function formatForFile(level: LogLevel, msg: string, ctx?: LogContext): string {
  const header = format(level, msg, ctx);
  const rawErr = ctx?.err;
  if (rawErr instanceof Error && typeof rawErr.stack === 'string') {
    const indented = rawErr.stack
      .split('\n')
      .map((line) => `    ${line}`)
      .join('\n');
    return `${header}\n${indented}\n`;
  }
  return `${header}\n`;
}

// --- file sink -------------------------------------------------------------

let sinkPath: string | undefined;

/** Configure the persistent file sink. Called once at process start by the
 *  long-lived `mcp`/`serve` commands (after their `.substrate/`-exists guard). */
export function configureFileSink(path: string): void {
  sinkPath = path;
}

/** Clear the sink. TESTS ONLY (module-global `sinkPath` leaks across a vitest
 *  worker) — production code never calls this. */
export function resetFileSink(): void {
  sinkPath = undefined;
}

/**
 * Write one composed event to the sink: lazy-mkdir → stat → maybe-rotate →
 * single append. The WHOLE function is best-effort — any failure (disk full,
 * permission, racing rotation) is swallowed, because a logging failure must
 * never crash the process. Synchronous so the line lands before a possible
 * crash (serve's shutdown/`beforeExit` can't await).
 */
function writeEvent(event: string): void {
  const path = sinkPath;
  if (path === undefined) return;
  try {
    mkdirSync(dirname(path), { recursive: true });
    let size = 0;
    try {
      size = statSync(path).size;
    } catch {
      size = 0; // ENOENT → fresh file
    }
    if (size + Buffer.byteLength(event) > LOG_MAX_BYTES) {
      try {
        renameSync(path, `${path}.1`); // overwrite any prior .1 (single generation)
      } catch {
        // fall through to a plain append — tolerate one over-cap event
      }
    }
    appendFileSync(path, event); // one syscall per event (atomic up to PIPE_BUF)
  } catch {
    // logging must never throw into the caller
  }
}

export const logger = {
  info(msg: string, ctx?: LogContext): void {
    console.log(format('info', msg, ctx));
    // info never hits the file — operational chatter only.
  },
  warn(msg: string, ctx?: LogContext): void {
    console.warn(format('warn', msg, ctx));
    if (sinkPath !== undefined) writeEvent(formatForFile('warn', msg, ctx));
  },
  error(msg: string, ctx?: LogContext): void {
    console.error(format('error', msg, ctx));
    if (sinkPath !== undefined) writeEvent(formatForFile('error', msg, ctx));
  },
};
