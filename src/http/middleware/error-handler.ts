import type { ErrorHandler } from 'hono';
import { SubstrateError, httpStatusFor } from '../../core/errors.js';
import { errorEnvelope } from '../../core/envelope.js';
import { logger } from '../../shared/logger.js';

/**
 * Top-level error handler for the Hono app. Catches anything thrown from
 * routes or middleware that wasn't already turned into a Response.
 *
 *  - SubstrateError: serialized as the standard error envelope with the
 *    code's mapped HTTP status. `details` is preserved verbatim.
 *  - Anything else: logged scrubbed, returned as a 500 with a generic
 *    `internal_error` envelope. The original error message is NOT
 *    reflected to the client (avoid leaking internal details).
 */
export const errorHandler: ErrorHandler = (err, c) => {
  if (SubstrateError.is(err)) {
    return c.json(errorEnvelope(err), httpStatusFor(err.code));
  }
  logger.error('Unhandled error in HTTP route', {
    error: (err as Error).message,
    path: c.req.path,
    method: c.req.method,
  });
  return c.json(errorEnvelope(SubstrateError.internalError('Internal error')), 500);
};
