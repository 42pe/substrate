import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  successEnvelope,
  type SuccessEnvelope,
  type ErrorEnvelope,
} from '../../../core/envelope.js';
import type { Board, FieldSchema } from '../../../core/types.js';
import { mutateBoardFile } from '../../../substrate/writer.js';
import { loadMembers } from '../../../substrate/loader.js';
import { validateBoardStructure } from '../../../substrate/validator.js';
import { FieldSchemaSchema, FieldSchemaEntrySchema } from '../../../substrate/schemas.js';
import { SubstrateError } from '../../../core/errors.js';
import { logger } from '../../../shared/logger.js';
import { wrapToolHandler } from '../../wrapper.js';
import type { ToolDeps } from '../../deps.js';
import { assertVersion, runEdit } from './substrate-edit.js';

/**
 * MCP tool: update_board — patch a board's name/description/field_schema. OCC on
 * board.version. The post-mutate result is structurally re-validated so a write
 * can never persist a structurally-invalid board.
 *
 * `field_schema` replaces the whole schema. `field_schema_patch` (dogfood
 * 2026-07-07) is a PARTIAL edit — merge/add the given fields, `null` deletes one
 * — so you can add a single field without resending the entire `task` + `comments`
 * maps (the whole-object requirement was a dogfood bail-to-hand-edit trigger).
 */

const fieldSectionPatch = z.record(z.string(), FieldSchemaEntrySchema.nullable());

/**
 * B3 (dogfood 2026-07-07): `human_only` is only a real gate if an agent can't
 * *un-protect* it. An agent's write tools already refuse to SET a human_only
 * field; this closes the sibling hole — refuse to clear the flag or delete the
 * field via `update_board`, which would otherwise let an agent downgrade its own
 * gate and then set it (a two-call self-approval). Removing the protection is a
 * human action (edit the board JSON directly). Task-scoped, matching where
 * human_only is enforced on write.
 */
function assertNoHumanOnlyDowngrade(before: FieldSchema, after: FieldSchema): void {
  const downgraded = Object.entries(before.task)
    .filter(
      ([field, entry]) => entry?.human_only === true && after.task[field]?.human_only !== true,
    )
    .map(([field]) => field);
  if (downgraded.length > 0) {
    throw SubstrateError.forbidden(
      `Field(s) ${downgraded.join(', ')} are human-only — an agent cannot remove or clear the ` +
        `human_only flag via update_board (that would let an agent unlock its own gate). ` +
        `Changing it is a human action: edit the board JSON directly.`,
      { fields: downgraded },
    );
  }
}

export const updateBoardShape = {
  id: z.string().min(1, 'id is required'),
  version: z.number().int().nonnegative(),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  field_schema: FieldSchemaSchema.optional(),
  field_schema_patch: z
    .object({ task: fieldSectionPatch.optional(), comments: fieldSectionPatch.optional() })
    .optional()
    .describe(
      'Partial field_schema edit: merge/add the given fields; a null value deletes a field. Use instead of resending the whole field_schema. Mutually exclusive with field_schema.',
    ),
  agent_name: z.string().min(1, 'agent_name is required'),
};
export const updateBoardSchema = z.object(updateBoardShape);
export type UpdateBoardInput = z.output<typeof updateBoardSchema>;

export function updateBoardHandler(
  input: UpdateBoardInput,
  deps: ToolDeps,
): Promise<SuccessEnvelope<Board> | ErrorEnvelope> {
  return runEdit('update_board', input.agent_name, async () => {
    const now = new Date().toISOString();
    if (input.field_schema !== undefined && input.field_schema_patch !== undefined) {
      throw SubstrateError.schemaViolation(
        'Provide either field_schema (full replace) or field_schema_patch (partial), not both.',
        { fields: ['field_schema', 'field_schema_patch'] },
      );
    }
    // Registry ids for the advisory team-integrity pass (v1 has no team WRITE,
    // but a hand-authored `team` already on disk is re-checked here so the write
    // path surfaces the same warnings the load path does — never fatal). Read
    // once, leniently; a member-load hiccup must not fail a board edit.
    const teamWarnings: string[] = [];
    const memberIds = new Set((await loadMembers(deps.root, [])).map((m) => m.id));

    const next = await mutateBoardFile(deps.root, input.id, (board) => {
      assertVersion(board.version, input.version, board.id);

      let fieldSchema: FieldSchema | undefined;
      if (input.field_schema !== undefined) {
        fieldSchema = input.field_schema as FieldSchema;
      } else if (input.field_schema_patch !== undefined) {
        const patch = input.field_schema_patch;
        const merged: FieldSchema = {
          task: { ...board.field_schema.task },
          comments: { ...board.field_schema.comments },
        };
        let changed = false;
        for (const section of ['task', 'comments'] as const) {
          const sectionPatch = patch[section];
          if (!sectionPatch) continue;
          for (const [field, entry] of Object.entries(sectionPatch)) {
            if (entry === null) {
              if (field in merged[section]) {
                delete merged[section][field];
                changed = true;
              }
            } else {
              merged[section][field] = entry as FieldSchema['task'][string];
              changed = true;
            }
          }
        }
        // Only apply (and bump version) if the patch actually changed the schema —
        // an empty/no-op patch must not burn an OCC version.
        if (changed) fieldSchema = merged;
      }

      // Nothing to change → return the board untouched (mutateBoardFile skips the
      // write when next === board, so no version bump on a no-op edit).
      if (
        input.name === undefined &&
        input.description === undefined &&
        fieldSchema === undefined
      ) {
        return { result: board, next: board };
      }

      if (fieldSchema !== undefined) assertNoHumanOnlyDowngrade(board.field_schema, fieldSchema);

      const updated: Board = {
        ...board,
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(fieldSchema !== undefined ? { field_schema: fieldSchema } : {}),
        version: board.version + 1,
        updated_at: now,
      };
      // schema_violation (structural) before commit; team integrity is advisory
      // (appends to teamWarnings, never throws).
      validateBoardStructure(updated, {
        memberIds,
        warn: (w) => teamWarnings.push(w),
      });
      return { result: updated, next: updated };
    });
    // Surface member/team advisories through the server's warning channel (the
    // same non-blocking route the load path / `substrate validate` uses). The
    // write already succeeded — these never block it.
    if (teamWarnings.length > 0) {
      logger.warn('update_board: board team has integrity warnings', {
        board_id: next.id,
        warnings: teamWarnings,
      });
    }
    return successEnvelope<Board>({
      entity: 'board',
      id: next.id,
      version: next.version,
      state: next,
    });
  });
}

export function registerUpdateBoard(server: McpServer, deps: ToolDeps): void {
  server.tool(
    'update_board',
    'Update a board (name, description, field_schema). Requires `version` and `agent_name`. Schema changes never reject existing data (lazy validation). To add/remove a single field without resending the whole schema, use `field_schema_patch` (merge; null deletes) instead of `field_schema`.',
    updateBoardShape,
    wrapToolHandler('update_board', updateBoardSchema, (input) => updateBoardHandler(input, deps)),
  );
}
