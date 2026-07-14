import type { Condition, LeafCondition } from './types.js';

/**
 * Helpers for asking "which task fields does a guard's condition tree reference?"
 *
 * Shared by the pending-approval derivation (`pendingApprovalFor`) and the
 * `substrate unapprove` stranded-gate warning, so both surfaces agree on which
 * `human_only` field a guard is really gated on — "pending" and "stranded" can
 * never diverge because they read the same code.
 */

/**
 * The task custom-field NAME a leaf path targets, or null if it's not a task field.
 * Assumes a FLAT field schema (which `field_schema.task` is): `task.custom_data.X`
 * (explicit) or `task.X` (resolves to custom_data via the evaluator's fallback) → `X`.
 * A deeper path (`task.custom_data.X.Y`) reports `X`; a field literally named like a
 * task column (`task.title`) reports `title` — neither can be `human_only` in a real
 * schema, so the human_only intersection filters them out harmlessly.
 */
export function taskFieldName(path: string): string | null {
  if (typeof path !== 'string') return null;
  const segs = path.split('.');
  if (segs[0] !== 'task') return null;
  if (segs[1] === 'custom_data') return segs[2] ?? null;
  return segs[1] ?? null;
}

/** Flatten all leaf conditions out of a (possibly compound) condition tree. */
export function collectLeaves(conds: Condition[], out: LeafCondition[] = []): LeafCondition[] {
  if (!Array.isArray(conds)) return out;
  for (const c of conds) {
    if (typeof c !== 'object' || c === null) continue;
    const rec = c as Record<string, unknown>;
    if (Array.isArray(rec['all_of'])) collectLeaves(rec['all_of'] as Condition[], out);
    else if (Array.isArray(rec['any_of'])) collectLeaves(rec['any_of'] as Condition[], out);
    else if (Array.isArray(rec['none_of'])) collectLeaves(rec['none_of'] as Condition[], out);
    else if (typeof rec['field'] === 'string' && typeof rec['op'] === 'string')
      out.push(c as LeafCondition);
  }
  return out;
}
