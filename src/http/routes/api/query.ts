import { z, type ZodRawShape } from 'zod';
import { SubstrateError } from '../../../core/errors.js';

/**
 * Query-string coercion + validation for the HTTP read API.
 *
 * The MCP read handlers assume Zod-validated input (the MCP path validates in
 * `wrapToolHandler`). The HTTP routes get raw strings, so each route builds a
 * candidate input with these coercers and then runs it through the tool's own
 * Zod shape via `validateInput`. A malformed value becomes `schema_violation`
 * → 400 (never a 500), which the existing error-handler maps.
 */

/** `'true'`→true, `'false'`→false, absent→undefined, anything else→400. */
export function boolParam(raw: string | undefined, name: string): boolean | undefined {
  if (raw === undefined) return undefined;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw SubstrateError.schemaViolation(`Query '${name}' must be 'true' or 'false', got '${raw}'.`, {
    param: name,
  });
}

/** A base-10 integer, absent→undefined, non-integer→400. */
export function intParam(raw: string | undefined, name: string): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n)) {
    throw SubstrateError.schemaViolation(`Query '${name}' must be an integer, got '${raw}'.`, {
      param: name,
    });
  }
  return n;
}

/** Comma-separated list, absent→undefined, empty→undefined. */
export function listParam(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  const items = raw.split(',').filter((s) => s.length > 0);
  return items.length > 0 ? items : undefined;
}

/** Plain string, absent→undefined. (Zod `.min(1)` rejects an empty value → 400.) */
export function strParam(raw: string | undefined): string | undefined {
  return raw;
}

/**
 * `parent_id` distinguishes three states (list_comments semantics):
 *   - omitted        → undefined (no filter)
 *   - `?parent_id=null` → null (thread-root comments only)
 *   - `?parent_id=<id>` → the id (replies to that comment)
 */
export function parentIdParam(raw: string | undefined): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === 'null') return null;
  return raw;
}

/** Build the shared `{ cursor?, page_size? }` pagination input (or undefined). */
export function paginationParam(c: {
  req: { query: (k: string) => string | undefined };
}): { cursor?: string; page_size?: number } | undefined {
  const cursor = strParam(c.req.query('cursor'));
  const page_size = intParam(c.req.query('page_size'), 'page_size');
  if (cursor === undefined && page_size === undefined) return undefined;
  return {
    ...(cursor !== undefined ? { cursor } : {}),
    ...(page_size !== undefined ? { page_size } : {}),
  };
}

/**
 * Validate a candidate input against a tool's Zod raw shape, returning the
 * parsed output. Throws `schema_violation` (→ 400) on any failure — this is the
 * single place a bad query becomes a clean 400.
 */
export function validateInput<S extends ZodRawShape>(
  shape: S,
  raw: Record<string, unknown>,
): z.output<z.ZodObject<S>> {
  const result = z.object(shape).safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first?.path.join('.');
    const message = first
      ? `Invalid query${path ? ` at '${path}'` : ''}: ${first.message}.`
      : 'Invalid query.';
    throw SubstrateError.schemaViolation(message, { issues: result.error.issues });
  }
  return result.data;
}
