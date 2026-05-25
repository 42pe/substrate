import type { MiddlewareHandler } from 'hono';
import { SubstrateError } from '../../core/errors.js';
import { errorEnvelope } from '../../core/envelope.js';
import { httpStatusFor } from '../../core/errors.js';

/**
 * Origin/Host header allowlist. Defeats two real attacks against local HTTP
 * servers:
 *
 *  - DNS rebinding: a website you visit resolves attacker.com first to a
 *    public IP (serves malicious JS), then re-resolves to 127.0.0.1. The
 *    JS can `fetch('http://127.0.0.1:7475/...')`. Without a Host/Origin
 *    check, our server replies normally and the attacker reads everything.
 *  - Browser CSRF: any tab can submit a form to localhost:7475. Without
 *    Origin validation, our server processes the request.
 *
 * Decision rules:
 *  - Origin header absent (curl, server-to-server, MCP stdio): allow.
 *  - Origin header present and in the allowlist: allow.
 *  - Origin header present and not in the allowlist: 403 forbidden.
 *  - Host header present and not in the allowlist: 403 forbidden.
 *    (Defeats DNS rebinding even if Origin is absent.)
 */
export function originAllowlist(opts: {
  allowedOrigins: readonly string[];
  allowedHosts: readonly string[];
}): MiddlewareHandler {
  return async (c, next) => {
    const origin = c.req.header('origin');
    if (origin !== undefined && !opts.allowedOrigins.includes(origin)) {
      const err = SubstrateError.forbidden('Origin not allowed', { origin });
      return c.json(errorEnvelope(err), httpStatusFor(err.code));
    }
    const host = c.req.header('host');
    if (host !== undefined && !opts.allowedHosts.includes(host)) {
      const err = SubstrateError.forbidden('Host not allowed', { host });
      return c.json(errorEnvelope(err), httpStatusFor(err.code));
    }
    await next();
  };
}
