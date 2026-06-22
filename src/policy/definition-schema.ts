import { z } from 'zod';
import { SubstrateError } from '../core/errors.js';
import type { LeafOperator } from './types.js';

/**
 * Zod validation for a policy `definition` — the shape the engine walks at
 * eval time (transition-guard.ts / agent-responsibility.ts / evaluator.ts).
 *
 * Why this exists: the on-disk `PolicySchema` (substrate/schemas.ts) types
 * `definition` as `Record<string, unknown>`, and the engine parses it
 * defensively (a shape it can't read becomes a policy that silently never
 * engages). That defensiveness is right at eval time but wrong at author time:
 * a guard with a typo'd `from_group` or a leaf with a misspelled `op` used to
 * be accepted and then quietly do nothing. These schemas catch that at
 * `create_policy` / `update_policy` time and on load, so a malformed gate fails
 * loudly instead of failing open.
 *
 * The engine's defensive parsing stays as a safety net for anything that
 * predates this validation; this is the author-time gate, not a replacement.
 */

/** The v1 locked leaf operator set (mirrors `LeafOperator` in types.ts). */
const LEAF_OPERATORS = [
  'exists',
  'not_exists',
  'is_empty',
  'not_empty',
  'eq',
  'neq',
  'in',
  'not_in',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'matches_regex',
  'matches_any_keyword',
  'has_any',
  'has_all',
] as const;

// Compile-time guard: keep LEAF_OPERATORS in lockstep with the LeafOperator union.
const _operatorsInSync: readonly LeafOperator[] = LEAF_OPERATORS;
void _operatorsInSync;

const LeafConditionSchema = z
  .object({
    field: z.string().min(1, 'leaf condition needs a non-empty `field`'),
    op: z.enum(LEAF_OPERATORS),
    value: z.unknown().optional(),
    values: z.array(z.unknown()).optional(),
  })
  .strict();

/**
 * A condition is a leaf (`field`/`op`) or a single compound combinator over
 * child conditions. Recursive, so it's declared with `z.lazy`. `.strict()`
 * turns a misspelled key (e.g. `valeu`, `any-of`) into a validation error
 * rather than a silently-ignored field. Typed loosely (the parsed value is
 * discarded — we only use `safeParse` for validation) so the recursive
 * `z.lazy` self-reference type-checks under `exactOptionalPropertyTypes`.
 */
const ConditionSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.object({ all_of: z.array(ConditionSchema) }).strict(),
    z.object({ any_of: z.array(ConditionSchema) }).strict(),
    z.object({ none_of: z.array(ConditionSchema) }).strict(),
    LeafConditionSchema,
  ]),
);

const GuardDefinitionSchema = z
  .object({
    from_group: z.string().min(1, '`from_group` must be a group id or "*"'),
    to_group: z.string().min(1, '`to_group` must be a group id or "*"'),
    require: z.array(ConditionSchema).optional(),
    on_failure_message: z.string().nullable().optional(),
  })
  .strict();

const ResponsibilityDefinitionSchema = z
  .object({
    when: z.array(ConditionSchema).optional(),
    message: z.string().min(1, '`message` must be a non-empty string'),
  })
  .strict();

type PolicyType = 'transition_guard' | 'agent_responsibility';
type Raise = (message: string, details?: Record<string, unknown>) => SubstrateError;

/**
 * Validate a policy `definition` against its `type`. Throws via the supplied
 * `raise` factory so call sites pick the error code: `schema_violation` on the
 * write path (bad input), `internal_error` on the load path (corrupt on-disk
 * file) — mirroring the `validateBoardStructure` / `validateSubstrate` split.
 */
export function validatePolicyDefinition(
  type: PolicyType,
  definition: Record<string, unknown>,
  raise: Raise,
): void {
  const schema =
    type === 'transition_guard' ? GuardDefinitionSchema : ResponsibilityDefinitionSchema;
  const parsed = schema.safeParse(definition);
  if (parsed.success) return;

  const issue = parsed.error.issues[0];
  const path = issue && issue.path.length > 0 ? issue.path.join('.') : '(root)';
  throw raise(
    `Invalid ${type} definition at '${path}': ${issue?.message ?? 'malformed'}. See the policy DSL in skills/substrate/AUTHORING.md §3.`,
    { policy_type: type, issues: parsed.error.issues },
  );
}
