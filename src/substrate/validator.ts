import type { Board, Substrate } from '../core/types.js';
import { SubstrateError } from '../core/errors.js';

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
 * Every failure is `internal_error` — substrate is user-authored config, and a
 * structural mistake should fail loudly and point at the board, not silently
 * degrade. References to *archived* groups are allowed (soft delete shouldn't
 * retroactively invalidate substrate; the Phase 3 engine decides at eval time).
 */
export function validateSubstrate(substrate: Substrate): void {
  const seenBoardIds = new Set<string>();
  for (const board of substrate.boards) {
    if (seenBoardIds.has(board.id)) {
      throw SubstrateError.internalError(
        `Duplicate board id '${board.id}' across boards/*.json. Board IDs must be unique.`,
        { board_id: board.id },
      );
    }
    seenBoardIds.add(board.id);
    validateBoard(board);
  }
}

function validateBoard(board: Board): void {
  // Duplicate group IDs within the board.
  const groupIds = new Set<string>();
  for (const group of board.groups) {
    if (groupIds.has(group.id)) {
      throw SubstrateError.internalError(
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
        throw SubstrateError.internalError(
          `Field '${field}' in board '${board.id}' field_schema.${section} is type 'enum' but declares no 'values'. Add a non-empty values array.`,
          { board_id: board.id, section, field },
        );
      }
    }
  }

  // transition_guard policies must reference groups that exist (archived OK).
  // '*' is a wildcard ("any group"), not a reference.
  for (const policy of board.policies) {
    if (policy.type !== 'transition_guard') continue;
    for (const key of ['from_group', 'to_group'] as const) {
      const ref = policy.definition[key];
      if (typeof ref !== 'string' || ref === '*') continue;
      if (!groupIds.has(ref)) {
        throw SubstrateError.internalError(
          `Policy '${policy.id}' in board '${board.id}' references ${key} '${ref}', which is not a group in this board.`,
          { board_id: board.id, policy_id: policy.id, group_id: ref },
        );
      }
    }
  }
}
