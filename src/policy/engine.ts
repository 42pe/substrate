import type { Board, Policy } from '../core/types.js';
import type { PolicyFiredEntry } from '../core/envelope.js';
import { SubstrateError } from '../core/errors.js';
import type { EvalContext } from './types.js';
import { parseGuardDefinition, guardEngages, guardPasses } from './transition-guard.js';
import { parseResponsibilityDefinition, responsibilityMatches } from './agent-responsibility.js';

/**
 * Per-write policy orchestration.
 *
 * These are plain functions the WRITE HANDLER calls at the right points — the
 * engine never opens a transaction (Phase 2 lock: the handler owns the tx).
 * Guards run inside the handler's transaction *before* the UPDATE, so a block
 * rolls the whole write back; responsibilities run *after* commit against the
 * post-write state. v1 has no automation class, so policies never mutate state.
 *
 * Both paths skip disabled (`enabled: false`) and archived policies, and order
 * by `priority` ascending then `created_at` (design doc §Execution semantics).
 */

function byPriorityThenCreatedAt(a: Policy, b: Policy): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
}

function activePoliciesOfType(board: Board, type: Policy['type']): Policy[] {
  return board.policies
    .filter((p) => p.type === type && p.enabled && p.archived_at === null)
    .sort(byPriorityThenCreatedAt);
}

function toPolicyEntry(policy: Policy, message?: string): PolicyFiredEntry {
  return {
    policy_id: policy.id,
    policy_name: policy.name,
    policy_type: policy.type,
    ...(policy.description ? { description: policy.description } : {}),
    ...(message !== undefined ? { message } : {}),
  };
}

/**
 * Evaluate transition_guards for an `update_task` group change. Returns the
 * entries for guards that engaged AND passed (informational, no message).
 * Throws `transition_blocked` on the FIRST engaged guard that fails (priority
 * order; later guards are not evaluated).
 */
export function runTransitionGuards(args: {
  board: Board;
  fromGroup: string;
  toGroup: string;
  candidate: EvalContext;
}): PolicyFiredEntry[] {
  const { board, fromGroup, toGroup, candidate } = args;
  const fired: PolicyFiredEntry[] = [];

  for (const policy of activePoliciesOfType(board, 'transition_guard')) {
    const def = parseGuardDefinition(policy.definition);
    if (!def) continue; // malformed → does not engage
    if (!guardEngages(def, fromGroup, toGroup)) continue;

    if (guardPasses(def, candidate)) {
      fired.push(toPolicyEntry(policy));
    } else {
      const message =
        def.onFailureMessage ??
        `Policy '${policy.name}' blocks moving from '${fromGroup}' to '${toGroup}'.`;
      throw SubstrateError.transitionBlocked(message, {
        policy_id: policy.id,
        from_group: fromGroup,
        to_group: toGroup,
      });
    }
  }

  return fired;
}

/**
 * Evaluate agent_responsibilities against post-write state. Returns an entry
 * (with `message`) for each matching policy. Never throws / never blocks.
 */
export function runAgentResponsibilities(args: {
  board: Board;
  state: EvalContext;
}): PolicyFiredEntry[] {
  const { board, state } = args;
  const fired: PolicyFiredEntry[] = [];

  for (const policy of activePoliciesOfType(board, 'agent_responsibility')) {
    const def = parseResponsibilityDefinition(policy.definition);
    if (!def) continue; // unusable message → does not fire
    if (responsibilityMatches(def, state)) {
      fired.push(toPolicyEntry(policy, def.message));
    }
  }

  return fired;
}
