/**
 * Minimal logger for v1. Wraps console; sanitizes `agent_name` from context.
 *
 * The `agent_name` value on writes is treated as untrusted input (workflow.md
 * §Instrumentation): we never reflect it unsanitized into terminal output,
 * since control chars / newlines could be used for log injection.
 *
 * Structured logging (pino, etc.) deferred to v1.x.
 */
export type LogLevel = 'info' | 'warn' | 'error';

export interface LogContext {
  agent_name?: string;
  [key: string]: unknown;
}

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

function format(level: LogLevel, msg: string, ctx?: LogContext): string {
  const ts = new Date().toISOString();
  if (!ctx) {
    return `${ts} ${level.toUpperCase()} ${msg}`;
  }
  const safeCtx: Record<string, unknown> = { ...ctx };
  if (typeof safeCtx.agent_name === 'string') {
    safeCtx.agent_name = sanitizeAgentName(safeCtx.agent_name);
  }
  return `${ts} ${level.toUpperCase()} ${msg} ${JSON.stringify(safeCtx)}`;
}

export const logger = {
  info(msg: string, ctx?: LogContext): void {
    console.log(format('info', msg, ctx));
  },
  warn(msg: string, ctx?: LogContext): void {
    console.warn(format('warn', msg, ctx));
  },
  error(msg: string, ctx?: LogContext): void {
    console.error(format('error', msg, ctx));
  },
};
