import type { FieldSchemaEntry } from '../core/types.js';
import { SubstrateError } from '../core/errors.js';

/**
 * Per-write runtime validation of `custom_data` against a board's
 * `field_schema` (PRD §6.10 lazy validation). Called by write handlers on
 * create_task / update_task / comment writes.
 *
 * Three deliberate non-behaviors:
 *   - Only `touched_keys` are checked — an update never re-validates fields it
 *     didn't write, so a stale-but-untouched value can't block a write.
 *   - Undeclared keys are accepted silently — `custom_data` is free-form;
 *     field_schema declares constraints, not an allow-list.
 *   - `required` is NOT enforced here — required-but-missing surfaces via
 *     `list_tasks(missing_required_fields)`, it never blocks a write.
 *
 * A `null` on a touched key means "delete this key" (partial-merge rule) and is
 * always allowed regardless of the declared type.
 */
export interface FieldValidationContext {
  field_schema: Record<string, FieldSchemaEntry>;
  /** The full post-merge custom_data (used to read each touched key's value). */
  merged_custom_data: Record<string, unknown>;
  touched_keys: string[];
}

/** Throws `schema_violation` on the first type/enum mismatch. */
export function validateFieldSchema(ctx: FieldValidationContext): void {
  for (const key of ctx.touched_keys) {
    const entry = ctx.field_schema[key];
    if (!entry) continue; // undeclared → free-form, accepted

    const value = ctx.merged_custom_data[key];
    if (value === null || value === undefined) continue; // deletion, always allowed

    const failure = checkType(entry, value);
    if (failure) {
      throw SubstrateError.schemaViolation(
        `Field '${key}' must be ${failure.expected}, got ${failure.got}. Update custom_data.${key} and retry.`,
        { field: key, expected: failure.expected, got: failure.got },
      );
    }
  }
}

interface TypeFailure {
  expected: string;
  got: string;
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function checkType(entry: FieldSchemaEntry, value: unknown): TypeFailure | null {
  switch (entry.type) {
    case 'string':
    case 'markdown':
      return typeof value === 'string' ? null : { expected: 'a string', got: describe(value) };
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
        ? null
        : { expected: 'a finite number', got: describe(value) };
    case 'boolean':
      return typeof value === 'boolean' ? null : { expected: 'a boolean', got: describe(value) };
    case 'enum': {
      const values = entry.values ?? [];
      if (typeof value === 'string' && values.includes(value)) return null;
      return { expected: `one of [${values.join(', ')}]`, got: describe(value) };
    }
    case 'string_list':
      return Array.isArray(value) && value.every((el) => typeof el === 'string')
        ? null
        : { expected: 'an array of strings', got: describe(value) };
    default:
      return null;
  }
}
