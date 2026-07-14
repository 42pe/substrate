import type { Board, Task } from '../core/types.js';
import { parseGuardDefinition, guardPasses } from './transition-guard.js';
import { evaluateCondition } from './evaluator.js';
import type { EvalContext } from './types.js';
import { collectLeaves, taskFieldName } from './field-refs.js';

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

    // Only a guard that ACTUALLY BLOCKS the move right now can make a task pending.
    // Evaluate the whole `require` tree (as the write path + check_transition do) —
    // never trust a single leaf in isolation, or a guard passable via an `any_of`
    // alternate branch (e.g. approved OR skip_approval) would falsely report the
    // human field as awaiting on a move that's already allowed.
    if (guardPasses(def, ctx)) continue;

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
