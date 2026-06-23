import type { Board, Substrate } from '../core/types.js';
import { SubstrateError } from '../core/errors.js';
import { validatePolicyDefinition } from '../policy/definition-schema.js';
import { corruptBoardError } from './corrupt.js';

/**
 * Cross-board structural validation, run once after every board file parses
 * (loader.ts step 5). Zod (schemas.ts) guarantees each file's *shape*; this
 * guarantees the substrate's *integrity* — things Zod can't see because they
 * span fields or boards:
 *
 *   - duplicate board IDs across files,
 *   - duplicate group IDs within a board,
 *   - `type: 'enum'` field_schema entries missing `values`,
 *   - `transition_guard` policies pointing at a group that doesn't exist.
 *
 * On the LOAD path every failure is `internal_error` — substrate is user-
 * authored config, and a structural mistake should fail loudly. References to
 * *archived* groups are allowed (soft delete shouldn't retroactively invalidate
 * substrate; the Phase 3 engine decides at eval time).
 *
 * Phase 4 reuses the per-board shape checks on the WRITE path via
 * `validateBoardStructure`, which raises `schema_violation` instead (the edit
 * tool is reacting to a bad *input*, not a corrupt on-disk file). The shared
 * logic takes an error factory so the two call sites differ only in error code.
 */

/** An error factory: `(message, details) => SubstrateError`. */
type Raise = (message: string, details?: Record<string, unknown>) => SubstrateError;
export function validateSubstrate(substrate: Substrate): void {
  const seenBoardIds = new Set<string>();
  for (const board of substrate.boards) {
    if (seenBoardIds.has(board.id)) {
      throw corruptBoardError({
        file: `boards/${board.id}.json`,
        problem: `duplicate board id '${board.id}' — board ids must be unique across boards/*.json`,
        details: { board_id: board.id },
      });
    }
    seenBoardIds.add(board.id);
    validateBoard(board);
  }
}

/**
 * Per-board STRUCTURAL checks shared by the load path and the write path:
 * duplicate group ids within the board, and `enum` field_schema entries that
 * declare no `values`. The `raise` factory sets the error code.
 */
function checkBoardStructure(board: Board, raise: Raise): void {
  // Duplicate group IDs within the board.
  const groupIds = new Set<string>();
  for (const group of board.groups) {
    if (groupIds.has(group.id)) {
      throw raise(
        `Duplicate group id '${group.id}' in board '${board.id}'. Group IDs must be unique within a board.`,
        { board_id: board.id, group_id: group.id },
      );
    }
    groupIds.add(group.id);
  }

  // Malformed field_schema: enum entries must declare `values`.
  for (const section of ['task', 'comments'] as const) {
    for (const [field, entry] of Object.entries(board.field_schema[section])) {
      if (entry.type === 'enum' && (!entry.values || entry.values.length === 0)) {
        throw raise(
          `Field '${field}' in board '${board.id}' field_schema.${section} is type 'enum' but declares no 'values'. Add a non-empty values array.`,
          { board_id: board.id, section, field },
        );
      }
    }
  }
}

/**
 * Validate one board's structure on the WRITE path (edit tools) — raises
 * `schema_violation`. Called on both the input and the post-mutate result so a
 * substrate edit can never persist a structurally-invalid board.
 */
export function validateBoardStructure(board: Board): void {
  checkBoardStructure(board, SubstrateError.schemaViolation);
}

function validateBoard(board: Board): void {
  // Load path: a structurally-broken on-disk board is `substrate_corrupt` (an
  // authored file the user can fix), carrying the file path + a paste-able
  // agent prompt. (The write path keeps `schema_violation` — see
  // validateBoardStructure — because there the edit *input* is at fault.)
  const corrupt: Raise = (message, details) =>
    corruptBoardError({ file: `boards/${board.id}.json`, problem: message, details });

  checkBoardStructure(board, corrupt);

  const groupIds = new Set(board.groups.map((g) => g.id));

  for (const policy of board.policies) {
    // Shape: a malformed definition must fail the load loudly rather than load
    // fine and silently never engage. Carries the policy id.
    validatePolicyDefinition(policy.type, policy.definition, (message, details) =>
      corrupt(`policy '${policy.id}': ${message}`, { policy_id: policy.id, ...details }),
    );

    // transition_guard policies must reference groups that exist (archived OK).
    // '*' is a wildcard ("any group"), not a reference.
    if (policy.type !== 'transition_guard') continue;
    for (const key of ['from_group', 'to_group'] as const) {
      const ref = policy.definition[key];
      if (typeof ref !== 'string' || ref === '*') continue;
      if (!groupIds.has(ref)) {
        throw corrupt(
          `policy '${policy.id}' references ${key} '${ref}', which is not a group in this board`,
          { policy_id: policy.id, group_id: ref },
        );
      }
    }
  }
}
