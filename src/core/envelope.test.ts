import { describe, it, expect } from 'vitest';
import { SubstrateError } from './errors.js';
import {
  successEnvelope,
  errorEnvelope,
  type SuccessEnvelope,
  type ErrorEnvelope,
} from './envelope.js';

describe('successEnvelope', () => {
  it('builds a well-formed envelope', () => {
    const env = successEnvelope({
      entity: 'task',
      id: 'task-1',
      version: 1,
      state: { id: 'task-1', title: 'hello' },
    });
    expect(env.ok).toBe(true);
    expect(env.applied.entity).toBe('task');
    expect(env.applied.id).toBe('task-1');
    expect(env.applied.version).toBe(1);
    expect(env.applied.state).toEqual({ id: 'task-1', title: 'hello' });
    expect(env.policies_fired).toEqual([]);
  });

  it('preserves provided policies_fired', () => {
    const env = successEnvelope({ entity: 'task', id: 't', version: 1, state: {} }, [
      {
        policy_id: 'p1',
        policy_name: 'tasks must have severity',
        policy_type: 'transition_guard',
      },
    ]);
    expect(env.policies_fired).toHaveLength(1);
    expect(env.policies_fired[0]?.policy_name).toBe('tasks must have severity');
  });

  it('is typed for narrow state generics', () => {
    interface SomeTask {
      id: string;
      title: string;
    }
    const env: SuccessEnvelope<SomeTask> = successEnvelope<SomeTask>({
      entity: 'task',
      id: 't',
      version: 1,
      state: { id: 't', title: 'x' },
    });
    expect(env.applied.state.title).toBe('x');
  });
});

describe('errorEnvelope', () => {
  it('builds an envelope from a SubstrateError without details', () => {
    const env: ErrorEnvelope = errorEnvelope(SubstrateError.notFound('task missing'));
    expect(env.ok).toBe(false);
    expect(env.error.code).toBe('not_found');
    expect(env.error.message).toBe('task missing');
    // exactOptionalPropertyTypes: details key absent when source had none
    expect('details' in env.error).toBe(false);
  });

  it('includes details when present', () => {
    const env = errorEnvelope(SubstrateError.schemaViolation('bad field', { field: 'priority' }));
    if (env.ok) throw new Error('expected error envelope');
    expect(env.error.details).toEqual({ field: 'priority' });
  });

  it('preserves all v1 error codes through round-trip', () => {
    const codes = [
      'schema_violation',
      'transition_blocked',
      'version_mismatch',
      'not_found',
      'conflict',
      'forbidden',
      'internal_error',
    ] as const;
    for (const code of codes) {
      const env = errorEnvelope(new SubstrateError(code, `msg-${code}`));
      expect(env.error.code).toBe(code);
    }
  });
});
