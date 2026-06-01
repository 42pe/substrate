/**
 * Policy condition types — the shape of a policy `definition`'s condition tree.
 *
 * These describe the *evaluatable* structure the engine walks; they are NOT the
 * Zod-validated board schema (that's `substrate/schemas.ts`, where `definition`
 * is `Record<string, unknown>`). Conditions are read out of that unstructured
 * blob at evaluation time and may be malformed — the evaluator and policy
 * classes degrade gracefully rather than trusting these types at runtime.
 */

/** The v1 locked leaf operator set (design doc §Operator Set). */
export type LeafOperator =
  // existence
  | 'exists'
  | 'not_exists'
  | 'is_empty'
  | 'not_empty'
  // equality
  | 'eq'
  | 'neq'
  // sets
  | 'in'
  | 'not_in'
  // numeric
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  // string
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'matches_regex'
  | 'matches_any_keyword'
  // array
  | 'has_any'
  | 'has_all';

/** A single field/operator test. `value` for scalar ops, `values` for set/array ops. */
export interface LeafCondition {
  field: string;
  op: LeafOperator;
  value?: unknown;
  values?: unknown[];
}

/** A condition is a leaf or a compound combinator over child conditions. */
export type Condition =
  | LeafCondition
  | { all_of: Condition[] }
  | { any_of: Condition[] }
  | { none_of: Condition[] };

/**
 * The context a condition is evaluated against. v1 only has a `task` context
 * (comments don't trigger policies). Field references resolve against it via
 * the literal-then-`custom_data` rule (see `evaluator.ts`).
 */
export interface EvalContext {
  task: Record<string, unknown>;
}
