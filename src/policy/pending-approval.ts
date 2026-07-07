import type { Board, Task } from '../core/types.js';
import { parseGuardDefinition } from './transition-guard.js';
import { evaluateCondition } from './evaluator.js';
import type { Condition, EvalContext, LeafCondition } from './types.js';

/**
 * "Pending human approval" derivation (dogfood 2026-07-07, sprint pending-approval).
 *
 * A non-archived task is **pending human approval** when advancing it is gated on
 * a *human* decision: an active `transition_guard` engages on a move OUT of the
 * task's current group, its `require` tree references ≥1 field the board marks
 * `human_only` (B3), and that field is currently unsatisfied. The human sign-off
 * is the missing piece; `awaiting_fields` names exactly what a human must set.
 *
 * Pure + board-derived — no new task state. Reuses the same guard parser + field
 * evaluator the write path runs, so "pending" and the real gate never disagree.
 *
 * Simplification (per plan Decision 4 — start simple): a `human_only` field is
 * "awaiting" when the leaf that references it does not pass on its own. Positive
 * gates (`exists`/`eq` on the approval field) — the overwhelming case — are exact;
 * a human_only field buried in a `none_of` is evaluated leaf-standalone, which we
 * accept until dogfood shows it matters.
 */

export interface PendingGate {
  policy_id: string;
  policy_name: string;
  to_group: string;
}

export interface PendingApproval {
  pending: boolean;
  gate?: PendingGate;
  /** human_only fields (schema names) a human must set to unblock the move. */
  awaiting_fields: string[];
}

const NOT_PENDING: PendingApproval = { pending: false, awaiting_fields: [] };

/** The task custom-field NAME a leaf path targets, or null if it's not a task field. */
function taskFieldName(path: string): string | null {
  if (typeof path !== 'string') return null;
  const segs = path.split('.');
  if (segs[0] !== 'task') return null;
  // `task.custom_data.<name>` (explicit) or `task.<name>` (resolves to custom_data via fallback).
  if (segs[1] === 'custom_data') return segs[2] ?? null;
  return segs[1] ?? null;
}

/** Flatten all leaf conditions out of a (possibly compound) condition tree. */
function collectLeaves(conds: Condition[], out: LeafCondition[] = []): LeafCondition[] {
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

export function pendingApprovalFor(board: Board, task: Task): PendingApproval {
  if (task.archived_at) return NOT_PENDING;

  const humanOnly = new Set(
    Object.entries(board.field_schema.task)
      .filter(([, entry]) => entry?.human_only === true)
      .map(([name]) => name),
  );
  if (humanOnly.size === 0) return NOT_PENDING;

  const ctx: EvalContext = { task: task as unknown as Record<string, unknown> };

  for (const policy of board.policies) {
    if (policy.type !== 'transition_guard' || policy.enabled === false || policy.archived_at)
      continue;
    const def = parseGuardDefinition(policy.definition);
    if (!def) continue;

    // Engages on a move OUT of the current group ('*' = any).
    const fromOk = def.fromGroup === '*' || def.fromGroup === task.group_id;
    if (!fromOk) continue;
    // A move to the group you're already in is a no-op the write path never gates.
    if (def.toGroup !== '*' && def.toGroup === task.group_id) continue;

    const awaiting: string[] = [];
    for (const leaf of collectLeaves(def.require)) {
      const name = taskFieldName(leaf.field);
      if (
        name &&
        humanOnly.has(name) &&
        !awaiting.includes(name) &&
        !evaluateCondition(leaf, ctx)
      ) {
        awaiting.push(name);
      }
    }
    if (awaiting.length > 0) {
      return {
        pending: true,
        gate: { policy_id: policy.id, policy_name: policy.name, to_group: def.toGroup },
        awaiting_fields: awaiting,
      };
    }
  }
  return NOT_PENDING;
}
