import type { Condition, EvalContext } from './types.js';
import { evaluateConditions } from './evaluator.js';

/**
 * agent_responsibility policy class (design doc §Class: agent_responsibility).
 *
 * Never blocks; returns a structured suggestion when its `when` matches the
 * post-write task. Defensive parsing over the unstructured `definition`:
 *   - missing / non-string `message` ⇒ the policy can't produce a usable
 *     suggestion, so it does NOT fire (parse returns null).
 *   - absent / non-array `when` ⇒ no conditions ⇒ always matches (spec §3.4).
 */

export interface ResponsibilityDef {
  when: Condition[];
  message: string;
}

/** Parse a responsibility definition. Returns null when `message` is unusable. */
export function parseResponsibilityDefinition(
  definition: Record<string, unknown>,
): ResponsibilityDef | null {
  const message = definition['message'];
  if (typeof message !== 'string' || message.length === 0) return null;

  const rawWhen = definition['when'];
  const when = Array.isArray(rawWhen) ? (rawWhen as Condition[]) : [];

  return { when, message };
}

/** Does this responsibility match the given state? Empty `when` ⇒ always. */
export function responsibilityMatches(def: ResponsibilityDef, state: EvalContext): boolean {
  return evaluateConditions(def.when, state);
}
