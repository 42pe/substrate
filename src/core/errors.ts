/**
 * Substrate v1 error codes. Locked set; new codes require PRD update.
 *
 * See PRD §6.4 for the full list and rationale. No `auth_denied` (no tokens
 * in v1) and no `validation_failed` (no `validation` policy class in v1).
 */
export type ErrorCode =
  | 'schema_violation'
  | 'transition_blocked'
  | 'version_mismatch'
  | 'not_found'
  | 'conflict'
  | 'forbidden'
  | 'internal_error';

/**
 * Typed error class used throughout Substrate. Carries a stable code plus
 * optional structured details. Never accept untrusted data into `details`
 * without sanitization first — the error envelope is returned to callers.
 */
export class SubstrateError extends Error {
  public readonly code: ErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'SubstrateError';
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }

  static schemaViolation(message: string, details?: Record<string, unknown>): SubstrateError {
    return new SubstrateError('schema_violation', message, details);
  }

  static transitionBlocked(message: string, details?: Record<string, unknown>): SubstrateError {
    return new SubstrateError('transition_blocked', message, details);
  }

  static versionMismatch(message: string, details?: Record<string, unknown>): SubstrateError {
    return new SubstrateError('version_mismatch', message, details);
  }

  static notFound(message: string, details?: Record<string, unknown>): SubstrateError {
    return new SubstrateError('not_found', message, details);
  }

  static conflict(message: string, details?: Record<string, unknown>): SubstrateError {
    return new SubstrateError('conflict', message, details);
  }

  static forbidden(message: string, details?: Record<string, unknown>): SubstrateError {
    return new SubstrateError('forbidden', message, details);
  }

  static internalError(message: string, details?: Record<string, unknown>): SubstrateError {
    return new SubstrateError('internal_error', message, details);
  }

  /**
   * Type guard for narrowing unknown caught values.
   */
  static is(value: unknown): value is SubstrateError {
    return value instanceof SubstrateError;
  }
}

/**
 * HTTP status code for an error code, used by the HTTP error-handler
 * middleware (Step 6) when surfacing errors over HTTP.
 *
 * MCP responses also reference these via the envelope code, but the HTTP
 * status only matters for the JSON-API route surface.
 */
export const HTTP_STATUS_FOR: Readonly<Record<ErrorCode, number>> = {
  schema_violation: 400,
  transition_blocked: 422,
  version_mismatch: 409,
  not_found: 404,
  conflict: 409,
  forbidden: 403,
  internal_error: 500,
};

export function httpStatusFor(code: ErrorCode): number {
  return HTTP_STATUS_FOR[code];
}
