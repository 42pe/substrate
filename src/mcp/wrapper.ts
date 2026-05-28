import type { z } from 'zod';
import { SubstrateError } from '../core/errors.js';
import { errorEnvelope } from '../core/envelope.js';
import { logger } from '../shared/logger.js';

/**
 * Shared MCP tool wrapper — the outermost error surface for every tool (reads
 * and writes alike, per the Architect Reviewer lock).
 *
 * Reads rely entirely on this wrapper: their handlers throw `SubstrateError`
 * (e.g. not_found) and the wrapper converts. Write handlers ALSO catch
 * internally — not redundantly, but to attach `agent_name` to the scrubbed
 * server-side log before returning an envelope; the wrapper's own catch is
 * their backstop. Either way, every failure leaves through one envelope shape.
 *
 * A wrapped handler:
 *   1. Re-parses raw input against the tool's Zod schema. On failure, returns a
 *      `schema_violation` envelope (NOT a JSON-RPC param error) so a missing
 *      `agent_name` or a wrong-typed field reads the same as any other error.
 *   2. Runs the pure handler. A handler may either return raw data (reads) or a
 *      pre-built envelope (writes). If it returns an `ok:false` envelope, the
 *      result is marked `isError`.
 *   3. Catches `SubstrateError` thrown by the handler → error envelope.
 *   4. Catches anything else → logs it scrubbed server-side and returns a
 *      generic `internal_error` envelope (never reflect raw messages across the
 *      stdio boundary).
 *
 * Tools are still *registered* with their real Zod shape so `tools/list`
 * advertises an accurate schema. This wrapper re-parsing is both the
 * authoritative envelope conversion and what unit tests exercise directly.
 */

export interface McpTextResult {
  // Index signature so this structurally satisfies the SDK's CallToolResult
  // (which carries an open `[x: string]: unknown`).
  [x: string]: unknown;
  content: { type: 'text'; text: string }[];
  isError: boolean;
}

function jsonResult(payload: unknown, isError: boolean): McpTextResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }], isError };
}

/** Lead with where + what so an agent can fix the call without guessing. */
function humanReadableZodError(error: z.ZodError): string {
  const first = error.issues[0];
  if (!first) return 'Invalid input.';
  const path = first.path.join('.');
  return path
    ? `Invalid input at '${path}': ${first.message}. Fix it and retry.`
    : `Invalid input: ${first.message}. Fix it and retry.`;
}

function isErrorEnvelope(value: unknown): boolean {
  return typeof value === 'object' && value !== null && (value as { ok?: unknown }).ok === false;
}

export function wrapToolHandler<S extends z.ZodTypeAny>(
  toolName: string,
  schema: S,
  handler: (input: z.output<S>) => Promise<unknown>,
): (rawInput: unknown) => Promise<McpTextResult> {
  return async (rawInput: unknown): Promise<McpTextResult> => {
    const parsed = schema.safeParse(rawInput ?? {});
    if (!parsed.success) {
      return jsonResult(
        errorEnvelope(
          SubstrateError.schemaViolation(humanReadableZodError(parsed.error), {
            issues: parsed.error.issues,
          }),
        ),
        true,
      );
    }

    try {
      const result = await handler(parsed.data);
      return jsonResult(result, isErrorEnvelope(result));
    } catch (e) {
      if (SubstrateError.is(e)) return jsonResult(errorEnvelope(e), true);
      logger.error(`Unhandled error in ${toolName}`, { error: (e as Error).message });
      return jsonResult(errorEnvelope(SubstrateError.internalError('Internal error')), true);
    }
  };
}
