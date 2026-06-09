import { SubstrateError } from '../../../core/errors.js';
import { errorEnvelope, type SuccessEnvelope, type ErrorEnvelope } from '../../../core/envelope.js';
import { logger } from '../../../shared/logger.js';

/**
 * Shared helpers for the Phase 4 substrate-edit tools (board/group/policy/
 * project). All of them: version-CAS an entity, mutate the JSON file
 * atomically, and return a `SuccessEnvelope`.
 */

const VERSION_MISMATCH_MESSAGE =
  'This entity has been updated since you last read it. Re-read it, reconcile, ' +
  'then retry with the new version.';

/** Throw `version_mismatch` (no `current_version`, per the Phase 2 OCC lock). */
export function assertVersion(actual: number, expected: number, id: string): void {
  if (actual !== expected) {
    throw SubstrateError.versionMismatch(VERSION_MISMATCH_MESSAGE, { id });
  }
}

/**
 * Wrap an edit handler's body: return its SuccessEnvelope, convert a thrown
 * SubstrateError to an error envelope, and scrub any unknown error to a generic
 * internal_error (never reflect raw messages across the boundary).
 */
export async function runEdit<T>(
  toolName: string,
  agentName: string,
  body: () => Promise<SuccessEnvelope<T>>,
): Promise<SuccessEnvelope<T> | ErrorEnvelope> {
  try {
    return await body();
  } catch (e) {
    if (SubstrateError.is(e)) return errorEnvelope(e);
    logger.error(`Unhandled error in ${toolName} handler`, {
      error: (e as Error).message,
      err: e,
      agent_name: agentName,
    });
    return errorEnvelope(SubstrateError.internalError('Internal error'));
  }
}
