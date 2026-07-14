import type { Board, Member, Substrate } from '../core/types.js';
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
  // Defensive defaults: a few synthetic callers build `{ boards } as unknown as
  // Substrate` (template `add`/external validation) with no members/warnings.
  const members = substrate.members ?? [];
  const warnings = (substrate.warnings ??= []);
  const warn = (message: string): void => {
    warnings.push(message);
  };

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

  // Member/team integrity is ADVISORY — warnings, never errors, on BOTH the load
  // and write paths. It must never make a member/team problem fail a load or a
  // write (the whole layer is optional). Registry-level check (duplicate ids)
  // first, then each board's bindings against the registry id set.
  const memberIds = checkRegistryIntegrity(members, warn);
  for (const board of substrate.boards) {
    checkTeamIntegrity(board, memberIds, warn);
  }
}

/**
 * Registry-level integrity (advisory): duplicate member `id`. Returns the set of
 * registry ids so per-board binding checks can resolve `team[].member`.
 */
export function checkRegistryIntegrity(
  members: Member[],
  warn: (message: string) => void,
): Set<string> {
  const seen = new Set<string>();
  for (const member of members) {
    if (seen.has(member.id)) {
      warn(`Duplicate member id '${member.id}' in the registry — only the first is used.`);
    }
    seen.add(member.id);
  }
  return seen;
}

/**
 * Per-board team integrity (advisory): a `team[].member` not in the registry, a
 * `groups` id that isn't a group on the board (archived OK), and a duplicate
 * `member` within one board's team each emit a WARNING via `warn`. NEVER throws
 * and NEVER treats `groups` as enforcement — it is referential only. Shared by
 * the load path (validateSubstrate) and the write path (validateBoardStructure).
 */
export function checkTeamIntegrity(
  board: Board,
  memberIds: Set<string>,
  warn: (message: string) => void,
): void {
  const team = board.team;
  if (!team || team.length === 0) return;

  // Archived groups are allowed (soft delete shouldn't retroactively warn),
  // mirroring the transition_guard group-ref check.
  const groupIds = new Set(board.groups.map((g) => g.id));
  const seenMembers = new Set<string>();

  for (const binding of team) {
    if (seenMembers.has(binding.member)) {
      warn(
        `Board '${board.id}' team lists member '${binding.member}' more than once — the duplicate binding is redundant.`,
      );
    }
    seenMembers.add(binding.member);

    if (!memberIds.has(binding.member)) {
      warn(
        `Board '${board.id}' team references member '${binding.member}', which has no .substrate/members/${binding.member}.json — the binding renders as an unresolved member.`,
      );
    }

    for (const groupId of binding.groups ?? []) {
      if (!groupIds.has(groupId)) {
        warn(
          `Board '${board.id}' team member '${binding.member}' targets group '${groupId}', which is not a group on this board.`,
        );
      }
    }
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
 *
 * `teamCtx` threads the registry member id set + a warnings sink so the write
 * path produces the SAME advisory member/team warnings the load path does (the
 * v4 wrinkle). Team integrity is advisory: it appends warnings via
 * `teamCtx.warn` and NEVER throws — a dangling member/group in a board's team
 * never fails a write. Omit `teamCtx` (create_board / create_group) to run the
 * structural checks only.
 */
export function validateBoardStructure(
  board: Board,
  teamCtx?: { memberIds: Set<string>; warn: (message: string) => void },
): void {
  checkBoardStructure(board, SubstrateError.schemaViolation);
  if (teamCtx) checkTeamIntegrity(board, teamCtx.memberIds, teamCtx.warn);
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
