/**
 * Response envelope shapes per PRD §6 (Response envelopes).
 *
 * Every MCP write tool returns a SuccessEnvelope or ErrorEnvelope. Read
 * tools return raw data without an envelope (per PRD §6.5).
 */
import { SubstrateError, type ErrorCode } from './errors.js';

/**
 * Entry in `policies_fired`. Phase 3 will populate these; in Phases 1–2 the
 * array is always empty (no policy engine yet).
 */
export interface PolicyFiredEntry {
  policy_id: string;
  policy_name: string;
  policy_type: 'transition_guard' | 'agent_responsibility';
  description?: string;
  /** Set for `agent_responsibility` entries. */
  message?: string;
}

export type AppliedEntity = 'task' | 'comment' | 'board' | 'group' | 'policy' | 'project';

export interface SuccessEnvelope<T = unknown> {
  ok: true;
  applied: {
    entity: AppliedEntity;
    id: string;
    version: number;
    state: T;
  };
  policies_fired: PolicyFiredEntry[];
}

export interface ErrorEnvelope {
  ok: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}

export type Envelope<T = unknown> = SuccessEnvelope<T> | ErrorEnvelope;

/**
 * Build a success envelope. Phase 1 callers pass `policies_fired: []`
 * explicitly via the default; Phase 3 onward, the policy engine assembles
 * the array.
 */
export function successEnvelope<T>(
  applied: SuccessEnvelope<T>['applied'],
  policiesFired: PolicyFiredEntry[] = [],
): SuccessEnvelope<T> {
  return { ok: true, applied, policies_fired: policiesFired };
}

/**
 * Build an error envelope from a SubstrateError. `details` is included only
 * when set on the source error (exactOptionalPropertyTypes-friendly).
 */
export function errorEnvelope(error: SubstrateError): ErrorEnvelope {
  if (error.details !== undefined) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    };
  }
  return {
    ok: false,
    error: {
      code: error.code,
      message: error.message,
    },
  };
}
