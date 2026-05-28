import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { wrapToolHandler } from './wrapper.js';
import { SubstrateError } from '../core/errors.js';
import { errorEnvelope, successEnvelope } from '../core/envelope.js';

const schema = z.object({ id: z.string().min(1), agent_name: z.string().min(1) });

function parse(result: { content: { type: 'text'; text: string }[] }): unknown {
  return JSON.parse(result.content[0]!.text);
}

describe('wrapToolHandler', () => {
  it('passes validated input to the handler and returns its raw result', async () => {
    const wrapped = wrapToolHandler('t', schema, (input) => Promise.resolve({ echoed: input.id }));
    const result = await wrapped({ id: 'x', agent_name: 'a' });
    expect(result.isError).toBe(false);
    expect(parse(result)).toEqual({ echoed: 'x' });
  });

  it('returns a schema_violation envelope on invalid input (no throw)', async () => {
    const handler = vi.fn();
    const wrapped = wrapToolHandler('t', schema, handler);
    const result = await wrapped({ id: '' }); // missing agent_name, empty id
    expect(result.isError).toBe(true);
    const env = parse(result) as { ok: boolean; error: { code: string; details?: unknown } };
    expect(env.ok).toBe(false);
    expect(env.error.code).toBe('schema_violation');
    expect(env.error.details).toHaveProperty('issues');
    expect(handler).not.toHaveBeenCalled();
  });

  it('converts a thrown SubstrateError into its error envelope', async () => {
    const wrapped = wrapToolHandler('t', schema, () => {
      throw SubstrateError.notFound('Task gone', { entity: 'task', id: 'z' });
    });
    const result = await wrapped({ id: 'z', agent_name: 'a' });
    expect(result.isError).toBe(true);
    const env = parse(result) as { error: { code: string; details?: unknown } };
    expect(env.error.code).toBe('not_found');
    expect(env.error.details).toEqual({ entity: 'task', id: 'z' });
  });

  it('returns a generic internal_error and does NOT leak an unknown error message', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const wrapped = wrapToolHandler('t', schema, () => {
      throw new Error('secret: db at hunter2@internal');
    });
    const result = await wrapped({ id: 'z', agent_name: 'a' });
    expect(result.isError).toBe(true);
    const env = parse(result) as { error: { code: string; message: string } };
    expect(env.error.code).toBe('internal_error');
    expect(env.error.message).toBe('Internal error');
    expect(JSON.stringify(env)).not.toContain('hunter2');
    spy.mockRestore();
  });

  it('marks isError when a handler returns an ok:false envelope', async () => {
    const wrapped = wrapToolHandler('t', schema, () =>
      Promise.resolve(errorEnvelope(SubstrateError.conflict('nope', { id: 'z' }))),
    );
    const result = await wrapped({ id: 'z', agent_name: 'a' });
    expect(result.isError).toBe(true);
  });

  it('does not mark isError when a handler returns an ok:true envelope', async () => {
    const wrapped = wrapToolHandler('t', schema, () =>
      Promise.resolve(successEnvelope({ entity: 'task', id: 'z', version: 1, state: { id: 'z' } })),
    );
    const result = await wrapped({ id: 'z', agent_name: 'a' });
    expect(result.isError).toBe(false);
  });
});
