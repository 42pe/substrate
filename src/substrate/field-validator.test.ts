import { describe, it, expect } from 'vitest';
import { validateFieldSchema, type FieldValidationContext } from './field-validator.js';
import type { FieldSchemaEntry } from '../core/types.js';
import { SubstrateError } from '../core/errors.js';

function ctx(
  field_schema: Record<string, FieldSchemaEntry>,
  merged_custom_data: Record<string, unknown>,
  touched_keys = Object.keys(merged_custom_data),
): FieldValidationContext {
  return { field_schema, merged_custom_data, touched_keys };
}

describe('validateFieldSchema', () => {
  it('accepts each declared type when the value matches', () => {
    const schema: Record<string, FieldSchemaEntry> = {
      s: { type: 'string' },
      n: { type: 'number' },
      b: { type: 'boolean' },
      md: { type: 'markdown' },
      list: { type: 'string_list' },
      sev: { type: 'enum', values: ['low', 'high'] },
    };
    const data = { s: 'x', n: 3, b: true, md: '# h', list: ['a', 'b'], sev: 'high' };
    expect(() => validateFieldSchema(ctx(schema, data))).not.toThrow();
  });

  it('rejects a wrong type with schema_violation and actionable details', () => {
    let caught: unknown;
    try {
      validateFieldSchema(ctx({ n: { type: 'number' } }, { n: 'not-a-number' }));
    } catch (e) {
      caught = e;
    }
    expect(SubstrateError.is(caught)).toBe(true);
    if (SubstrateError.is(caught)) {
      expect(caught.code).toBe('schema_violation');
      expect(caught.details).toEqual({ field: 'n', expected: 'a finite number', got: 'string' });
    }
  });

  it('rejects a non-finite number', () => {
    expect(() => validateFieldSchema(ctx({ n: { type: 'number' } }, { n: Infinity }))).toThrow(
      SubstrateError,
    );
  });

  it('enum: rejects a value not in values', () => {
    expect(() =>
      validateFieldSchema(ctx({ sev: { type: 'enum', values: ['low', 'high'] } }, { sev: 'mid' })),
    ).toThrow(SubstrateError);
  });

  it('string_list: rejects an array with a non-string element', () => {
    expect(() =>
      validateFieldSchema(ctx({ list: { type: 'string_list' } }, { list: ['a', 2] })),
    ).toThrow(SubstrateError);
  });

  it('accepts undeclared keys (custom_data is free-form)', () => {
    expect(() =>
      validateFieldSchema(ctx({ s: { type: 'string' } }, { undeclared: 123 })),
    ).not.toThrow();
  });

  it('allows null on a touched key (deletion) regardless of declared type', () => {
    expect(() =>
      validateFieldSchema(ctx({ n: { type: 'number' } }, { n: null }, ['n'])),
    ).not.toThrow();
  });

  it('does NOT enforce required (missing required field is fine on write)', () => {
    const schema: Record<string, FieldSchemaEntry> = {
      sev: { type: 'enum', values: ['low'], required: true },
    };
    // sev required but not present / not touched → no throw.
    expect(() => validateFieldSchema(ctx(schema, {}, []))).not.toThrow();
  });

  it('only validates touched keys, ignoring other present values', () => {
    const schema: Record<string, FieldSchemaEntry> = { n: { type: 'number' } };
    // n holds a bad value but isn't touched → not validated.
    expect(() => validateFieldSchema(ctx(schema, { n: 'bad', other: 1 }, ['other']))).not.toThrow();
  });
});
