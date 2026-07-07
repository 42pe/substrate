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

/**
 * Throw `version_mismatch` when the caller's version is stale. B5 (dogfood
 * 2026-07-07, Diego-approved): include `current_version` in details (the message
 * still requires a re-read + reconcile) so a concurrent writer needn't fetch the
 * integer with an extra read.
 */
export function assertVersion(actual: number, expected: number, id: string): void {
  if (actual !== expected) {
    throw SubstrateError.versionMismatch(VERSION_MISMATCH_MESSAGE, { id, current_version: actual });
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
