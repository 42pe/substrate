import { describe, it, expect } from 'vitest';
import { SubstrateError, HTTP_STATUS_FOR, httpStatusFor, type ErrorCode } from './errors.js';

describe('SubstrateError', () => {
  it('preserves code and message', () => {
    const err = new SubstrateError('not_found', 'task missing');
    expect(err.code).toBe('not_found');
    expect(err.message).toBe('task missing');
    expect(err.name).toBe('SubstrateError');
  });

  it('preserves details when provided', () => {
    const err = new SubstrateError('schema_violation', 'bad field', { field: 'priority' });
    expect(err.details).toEqual({ field: 'priority' });
  });

  it('does not set details when undefined (exactOptionalPropertyTypes)', () => {
    const err = new SubstrateError('not_found', 'missing');
    expect(err.details).toBeUndefined();
    expect('details' in err && err.details !== undefined).toBe(false);
  });

  it('is throwable and catchable with instanceof', () => {
    expect(() => {
      throw SubstrateError.notFound('x');
    }).toThrow(SubstrateError);
    try {
      throw SubstrateError.notFound('x');
    } catch (e) {
      expect(SubstrateError.is(e)).toBe(true);
    }
  });

  it('extends Error', () => {
    const err = SubstrateError.conflict('x');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SubstrateError);
  });

  it('SubstrateError.is is a correct type guard', () => {
    expect(SubstrateError.is(new SubstrateError('not_found', 'x'))).toBe(true);
    expect(SubstrateError.is(new Error('x'))).toBe(false);
    expect(SubstrateError.is('string')).toBe(false);
    expect(SubstrateError.is(null)).toBe(false);
    expect(SubstrateError.is(undefined)).toBe(false);
  });

  describe('factory helpers', () => {
    const cases: Array<[keyof typeof SubstrateError, ErrorCode]> = [
      ['schemaViolation', 'schema_violation'],
      ['transitionBlocked', 'transition_blocked'],
      ['versionMismatch', 'version_mismatch'],
      ['notFound', 'not_found'],
      ['conflict', 'conflict'],
      ['forbidden', 'forbidden'],
      ['internalError', 'internal_error'],
    ];

    for (const [factoryName, expectedCode] of cases) {
      it(`${factoryName} produces code "${expectedCode}"`, () => {
        const factory = SubstrateError[factoryName] as (
          message: string,
          details?: Record<string, unknown>,
        ) => SubstrateError;
        const err = factory('msg');
        expect(err.code).toBe(expectedCode);
      });
    }
  });
});

describe('httpStatusFor', () => {
  it('returns the right status for each code', () => {
    expect(httpStatusFor('schema_violation')).toBe(400);
    expect(httpStatusFor('transition_blocked')).toBe(422);
    expect(httpStatusFor('version_mismatch')).toBe(409);
    expect(httpStatusFor('not_found')).toBe(404);
    expect(httpStatusFor('conflict')).toBe(409);
    expect(httpStatusFor('forbidden')).toBe(403);
    expect(httpStatusFor('internal_error')).toBe(500);
  });

  it('covers every ErrorCode (exhaustiveness)', () => {
    // If a new ErrorCode is added without updating HTTP_STATUS_FOR, this fails.
    const codes: ErrorCode[] = [
      'schema_violation',
      'transition_blocked',
      'version_mismatch',
      'not_found',
      'conflict',
      'forbidden',
      'internal_error',
    ];
    for (const code of codes) {
      expect(HTTP_STATUS_FOR[code]).toBeTypeOf('number');
    }
  });
});
