import type { Condition, EvalContext } from './types.js';
import { evaluateConditions } from './evaluator.js';

/**
 * transition_guard policy class (design doc §Class: transition_guard).
 *
 * A guard's `definition` lives in an unstructured `Record<string, unknown>`
 * (the Phase 2 loader only checks group-existence for from/to). So everything
 * here parses defensively: a shape it can't make sense of becomes a guard that
 * does NOT engage, never a thrown error.
 *
 * Engagement: the guard's `from_group` matches the prior group and `to_group`
 * matches the target group, with `'*'` as a wildcard on either side.
 * Evaluation: `require` (implicit all_of) against the candidate post-write task.
 */

export interface GuardDef {
  fromGroup: string;
  toGroup: string;
  require: Condition[];
  /** null ⇒ caller supplies a default block message. */
  onFailureMessage: string | null;
}

/** Parse a guard definition. Returns null when from/to aren't usable strings. */
export function parseGuardDefinition(definition: Record<string, unknown>): GuardDef | null {
  const from = definition['from_group'];
  const to = definition['to_group'];
  if (typeof from !== 'string' || typeof to !== 'string') return null;

  const rawRequire = definition['require'];
  const require = Array.isArray(rawRequire) ? (rawRequire as Condition[]) : [];

  const rawMsg = definition['on_failure_message'];
  const onFailureMessage = typeof rawMsg === 'string' ? rawMsg : null;

  return { fromGroup: from, toGroup: to, require, onFailureMessage };
}

/** Does this guard engage on a transition from→to? `'*'` matches any group. */
export function guardEngages(def: GuardDef, fromGroup: string, toGroup: string): boolean {
  const fromOk = def.fromGroup === '*' || def.fromGroup === fromGroup;
  const toOk = def.toGroup === '*' || def.toGroup === toGroup;
  return fromOk && toOk;
}

/** Evaluate an engaged guard's `require` against the candidate state. */
export function guardPasses(def: GuardDef, candidate: EvalContext): boolean {
  return evaluateConditions(def.require, candidate);
}
