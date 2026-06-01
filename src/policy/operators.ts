import type { LeafOperator, LeafCondition } from './types.js';

/**
 * The v1 locked operator set — pure functions over a resolved left-hand field
 * value and the condition's `value` / `values`.
 *
 * Two invariants, both load-bearing for engine safety:
 *   1. NEVER throw. A type mismatch, a bad operand, an invalid regex — every
 *      degenerate case returns `false` ("condition not met"). A malformed
 *      policy must never crash a write.
 *   2. No I/O, no substrate access. Just data in → boolean out.
 *
 * String ops (`contains`, `starts_with`, `ends_with`, `matches_regex`,
 * `matches_any_keyword`) coerce scalar fields to strings but NOT arrays — a
 * `string_list` custom field resolves to an array, which doesn't coerce, so
 * these ops no-match against list fields. Use `has_any` / `has_all` for lists.
 *
 * `matches_regex` is the only operator that compiles a substrate-authored
 * string. Substrate is user-authored (semi-trusted) and the server is single-
 * threaded, so a pathological pattern could hang it. Mitigation: cap the
 * pattern length and treat any non-string / oversized / throwing pattern as a
 * non-match (R-1). No full ReDoS sandbox in v1 — accepted risk for a local
 * single-user tool.
 */

const MAX_REGEX_PATTERN_LENGTH = 1000;

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined || v === '') return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v as Record<string, unknown>).length === 0;
  return false;
}

/** A finite number, else NaN — used to make numeric ops no-match on bad operands. */
function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : NaN;
}

function asString(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
}

function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // Structural equality for arrays/objects coming out of JSON.
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

/**
 * Apply a leaf operator. Returns false on any shape it can't satisfy.
 * `field` value is the already-resolved left-hand side.
 */
export function applyOperator(fieldValue: unknown, cond: LeafCondition): boolean {
  const op: LeafOperator = cond.op;
  const value = cond.value;
  const values = Array.isArray(cond.values) ? cond.values : [];

  switch (op) {
    case 'exists':
      return fieldValue !== null && fieldValue !== undefined;
    case 'not_exists':
      return fieldValue === null || fieldValue === undefined;
    case 'is_empty':
      return isEmpty(fieldValue);
    case 'not_empty':
      return !isEmpty(fieldValue);

    case 'eq':
      return jsonEqual(fieldValue, value);
    case 'neq':
      return !jsonEqual(fieldValue, value);

    case 'in':
      return values.some((v) => jsonEqual(fieldValue, v));
    case 'not_in':
      return !values.some((v) => jsonEqual(fieldValue, v));

    case 'gt': {
      const a = num(fieldValue);
      const b = num(value);
      return !Number.isNaN(a) && !Number.isNaN(b) && a > b;
    }
    case 'gte': {
      const a = num(fieldValue);
      const b = num(value);
      return !Number.isNaN(a) && !Number.isNaN(b) && a >= b;
    }
    case 'lt': {
      const a = num(fieldValue);
      const b = num(value);
      return !Number.isNaN(a) && !Number.isNaN(b) && a < b;
    }
    case 'lte': {
      const a = num(fieldValue);
      const b = num(value);
      return !Number.isNaN(a) && !Number.isNaN(b) && a <= b;
    }

    case 'contains': {
      const hay = asString(fieldValue);
      const needle = asString(value);
      return hay !== null && needle !== null && hay.includes(needle);
    }
    case 'not_contains': {
      const hay = asString(fieldValue);
      const needle = asString(value);
      // A non-string field "does not contain" the needle (vacuously true).
      if (hay === null || needle === null) return true;
      return !hay.includes(needle);
    }
    case 'starts_with': {
      const hay = asString(fieldValue);
      const pre = asString(value);
      return hay !== null && pre !== null && hay.startsWith(pre);
    }
    case 'ends_with': {
      const hay = asString(fieldValue);
      const suf = asString(value);
      return hay !== null && suf !== null && hay.endsWith(suf);
    }
    case 'matches_regex': {
      const hay = asString(fieldValue);
      if (hay === null || typeof value !== 'string') return false;
      if (value.length > MAX_REGEX_PATTERN_LENGTH) return false;
      try {
        return new RegExp(value).test(hay);
      } catch {
        return false; // invalid pattern → no match, never crash
      }
    }
    case 'matches_any_keyword': {
      const hay = asString(fieldValue);
      if (hay === null) return false;
      const lower = hay.toLowerCase();
      return values.some((kw) => {
        const k = asString(kw);
        return k !== null && lower.includes(k.toLowerCase());
      });
    }

    case 'has_any': {
      if (!Array.isArray(fieldValue)) return false;
      return values.some((v) => fieldValue.some((el) => jsonEqual(el, v)));
    }
    case 'has_all': {
      if (!Array.isArray(fieldValue)) return false;
      return values.every((v) => fieldValue.some((el) => jsonEqual(el, v)));
    }

    default:
      // Unknown operator (shouldn't happen — types constrain it) → no match.
      return false;
  }
}
