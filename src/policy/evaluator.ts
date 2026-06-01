import type { Condition, EvalContext, LeafCondition } from './types.js';
import { applyOperator } from './operators.js';

/**
 * Condition-tree evaluator.
 *
 * FIRST implementation of the field-reference rule decided in Phase 2
 * (`v1-architecture.md` §Phase 2). No Phase 2 code implements it — `list_tasks`
 * uses bound `$.key` JSON paths, a different mechanism — so this is net-new.
 *
 * ## Field-reference rule (literal-then-custom_data fallback)
 *
 * A dot path is resolved against the context **literally first**, then falls
 * back to the `custom_data`-nested path under the same root. Worked examples
 * for a `task` context `{ task: { title, group_id, custom_data: { priority } } }`:
 *
 *   - `task.title`            → literal `task.title`            (found)
 *   - `task.priority`         → literal `task.priority` (absent) → `task.custom_data.priority`
 *   - `task.custom_data.priority` → literal (found); no fallback needed
 *   - `task.nope`             → literal absent → `task.custom_data.nope` absent → `undefined`
 *   - `comment.x`             → root `comment` not in context → `undefined`
 *
 * Unresolvable paths yield `undefined` (so `exists` is false, `eq` no-match).
 * The evaluator NEVER throws — a malformed tree degrades to `false`.
 */

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Walk an object along dot-path segments; undefined if any hop isn't an object. */
function walk(obj: unknown, segs: string[]): unknown {
  let cur: unknown = obj;
  for (const seg of segs) {
    if (!isObject(cur)) return undefined;
    cur = cur[seg];
  }
  return cur;
}

/**
 * Resolve a dot-notation field reference against the context.
 * Literal path first; if that's `undefined`, retry with `custom_data` inserted
 * after the root (unless the path already targets `custom_data`).
 */
export function resolveField(path: string, ctx: EvalContext): unknown {
  if (typeof path !== 'string' || path.length === 0) return undefined;
  const segs = path.split('.');
  const root = segs[0]!;
  const rest = segs.slice(1);

  const rootObj = (ctx as unknown as Record<string, unknown>)[root];
  if (rootObj === undefined) return undefined;

  // Path is just the root (e.g. "task") → the whole context object.
  if (rest.length === 0) return rootObj;

  const literal = walk(rootObj, rest);
  if (literal !== undefined) return literal;

  // Fallback: <root>.custom_data.<rest...> — unless already under custom_data.
  if (rest[0] === 'custom_data') return undefined;
  return walk(rootObj, ['custom_data', ...rest]);
}

function isLeaf(cond: Condition): cond is LeafCondition {
  return (
    isObject(cond) &&
    typeof (cond as Record<string, unknown>)['field'] === 'string' &&
    typeof (cond as Record<string, unknown>)['op'] === 'string'
  );
}

/** Evaluate a single condition (leaf or compound). Never throws. */
export function evaluateCondition(cond: Condition, ctx: EvalContext): boolean {
  if (!isObject(cond)) return false;

  if (Array.isArray((cond as Record<string, unknown>)['all_of'])) {
    return (cond as { all_of: Condition[] }).all_of.every((c) => evaluateCondition(c, ctx));
  }
  if (Array.isArray((cond as Record<string, unknown>)['any_of'])) {
    return (cond as { any_of: Condition[] }).any_of.some((c) => evaluateCondition(c, ctx));
  }
  if (Array.isArray((cond as Record<string, unknown>)['none_of'])) {
    return !(cond as { none_of: Condition[] }).none_of.some((c) => evaluateCondition(c, ctx));
  }

  if (isLeaf(cond)) {
    return applyOperator(resolveField(cond.field, ctx), cond);
  }

  // Unrecognized shape → not met (defensive; never throw).
  return false;
}

/** Evaluate a list of conditions as an implicit `all_of` (empty ⇒ true). */
export function evaluateConditions(conds: Condition[], ctx: EvalContext): boolean {
  if (!Array.isArray(conds)) return true;
  return conds.every((c) => evaluateCondition(c, ctx));
}
