import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SubstrateError } from '../../../core/errors.js';
import { wrapToolHandler } from '../../wrapper.js';
import type { FieldSchema, Group, Member, Policy } from '../../../core/types.js';
import type { ToolDeps } from '../../deps.js';

/**
 * MCP tool: get_board_substrate — a board's full operating context.
 *
 * Returns groups, field_schema, and policies in one payload. Policies are
 * INCLUDED even though the engine doesn't ship until Phase 3: the v1 paradigm
 * bet is that agents reading policies self-enforce. `not_found` if the board
 * isn't in the substrate.
 */

export const getBoardSubstrateShape = {
  board_id: z.string().min(1, 'board_id is required'),
};
const getBoardSubstrateSchema = z.object(getBoardSubstrateShape);
export type GetBoardSubstrateInput = z.output<typeof getBoardSubstrateSchema>;

/**
 * A board team binding with its member identity resolved (JOINed) from the
 * project-level registry. `unresolved: true` carries only the referenced id (no
 * registry match) — surfaced so a dangling reference is visible, never dropped.
 * `groups` is the binding's advisory group association ON THIS board.
 */
export type ResolvedTeamMember =
  | { unresolved: false; member: Member; groups: string[] }
  | { unresolved: true; member: { id: string }; groups: string[] };

export interface BoardSubstrateResult {
  board: {
    id: string;
    name: string;
    description: string;
    version: number;
    created_at: string;
    updated_at: string;
    archived_at: string | null;
  };
  groups: Group[];
  field_schema: FieldSchema;
  policies: Policy[];
  /** The board's team, each member resolved against the registry. Empty when
   *  the board declares no team. Advisory metadata — never gates anything. */
  team: ResolvedTeamMember[];
}

export async function getBoardSubstrateHandler(
  input: GetBoardSubstrateInput,
  deps: ToolDeps,
): Promise<BoardSubstrateResult> {
  const substrate = await deps.loadSubstrate();
  const board = substrate.boards.find((b) => b.id === input.board_id);
  if (!board) {
    throw SubstrateError.notFound(
      `Board '${input.board_id}' not found. Use list_boards to see what's available.`,
      { entity: 'board', id: input.board_id },
    );
  }
  // JOIN the board's team bindings against the project-level member registry so
  // every consumer (MCP, HTTP → UI) sees resolved member identity, not bare ids.
  // An unresolved reference is surfaced with an `unresolved` marker rather than
  // dropped; an absent/empty team resolves to `[]`.
  const membersById = new Map(substrate.members.map((m) => [m.id, m]));
  const team: ResolvedTeamMember[] = (board.team ?? []).map((binding) => {
    const groups = binding.groups ?? [];
    const member = membersById.get(binding.member);
    return member
      ? { unresolved: false, member, groups }
      : { unresolved: true, member: { id: binding.member }, groups };
  });

  return {
    board: {
      id: board.id,
      name: board.name,
      description: board.description,
      version: board.version,
      created_at: board.created_at,
      updated_at: board.updated_at,
      archived_at: board.archived_at,
    },
    groups: board.groups,
    field_schema: board.field_schema,
    policies: board.policies,
    team,
  };
}

export function registerGetBoardSubstrate(server: McpServer, deps: ToolDeps): void {
  server.tool(
    'get_board_substrate',
    [
      "Fetch a board's complete operating context in one payload: groups, field_schema, and policies. Call this once per board before doing any work on it, then cache.",
      'field_schema.{task,comments} maps a field name → { type: string|number|boolean|enum|markdown|string_list, required?: boolean, values?: string[] (required when type=enum) }. Boolean "gate" fields are the inputs transition_guard policies check.',
      'Each policy has { type, definition, enabled, priority, ... }. transition_guard.definition = { from_group, to_group, require?, on_failure_message? } (BLOCKS a move); agent_responsibility.definition = { when?, message } (suggestion only). See `create_policy` for the Condition/operator grammar.',
      "team[] is the board's roster, each entry { member, groups, unresolved }: member identity (name, traits, concerns, memory_dir) is JOINed from the project-level registry; groups is the member's ADVISORY group association on this board (a hint, never a permission — nothing is gated on it); unresolved:true means the referenced member id has no registry file (surfaced, not dropped). Empty when the board declares no team.",
    ].join('\n'),
    getBoardSubstrateShape,
    wrapToolHandler('get_board_substrate', getBoardSubstrateSchema, (input) =>
      getBoardSubstrateHandler(input, deps),
    ),
  );
}
