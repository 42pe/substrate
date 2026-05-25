import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { errorHandler } from './error-handler.js';
import { SubstrateError } from '../../core/errors.js';

describe('errorHandler', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('serializes a SubstrateError to its envelope + mapped HTTP status', async () => {
    const app = new Hono();
    app.get('/', () => {
      throw SubstrateError.notFound('thing missing', { thing_id: 'x' });
    });
    app.onError(errorHandler);

    const res = await app.request('/');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { ok: boolean; error: { code: string; details: unknown } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('not_found');
    expect(body.error.details).toEqual({ thing_id: 'x' });
  });

  it('maps every SubstrateError code to its status', async () => {
    const codes: Array<[() => SubstrateError, number]> = [
      [() => SubstrateError.schemaViolation('x'), 400],
      [() => SubstrateError.transitionBlocked('x'), 422],
      [() => SubstrateError.versionMismatch('x'), 409],
      [() => SubstrateError.notFound('x'), 404],
      [() => SubstrateError.conflict('x'), 409],
      [() => SubstrateError.forbidden('x'), 403],
      [() => SubstrateError.internalError('x'), 500],
    ];

    for (const [makeErr, expectedStatus] of codes) {
      const app = new Hono();
      app.get('/', () => {
        throw makeErr();
      });
      app.onError(errorHandler);
      const res = await app.request('/');
      expect(res.status, `for code ${makeErr().code}`).toBe(expectedStatus);
    }
  });

  it('returns 500 + generic internal_error for unknown errors and does NOT leak the message', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const app = new Hono();
    app.get('/', () => {
      throw new Error('DB password is hunter2 and the secret token is sk-xyz');
    });
    app.onError(errorHandler);

    const res = await app.request('/');
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('internal_error');
    expect(body.error.message).toBe('Internal error');
    expect(body.error.message).not.toContain('hunter2');
    expect(body.error.message).not.toContain('sk-xyz');
  });

  it('logs the unknown error scrubbed (for server-side debugging)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const app = new Hono();
    app.get('/secret-path', () => {
      throw new Error('oops');
    });
    app.onError(errorHandler);

    await app.request('/secret-path');
    expect(spy).toHaveBeenCalled();
    const logCall = spy.mock.calls[0]?.[0] as string;
    expect(logCall).toContain('Unhandled error in HTTP route');
    expect(logCall).toContain('oops');
    expect(logCall).toContain('/secret-path');
  });
});
