import { existsSync } from 'node:fs';
import os from 'node:os';
import { substrateRootFromCwd, paths } from '../../shared/paths.js';
import { configureFileSink } from '../../shared/logger.js';
import { openDatabaseAndMigrate, withTransaction } from '../../storage/client.js';
import { loadSubstrate } from '../../substrate/loader.js';
import { getTask, updateTask } from '../../storage/repositories/tasks.js';
import { appendEvent } from '../../storage/repositories/events.js';
import { validateFieldSchema } from '../../substrate/field-validator.js';
import { parseGuardDefinition } from '../../policy/transition-guard.js';
import { collectLeaves, taskFieldName } from '../../policy/field-refs.js';
import { SubstrateError } from '../../core/errors.js';
import type { Board, Task } from '../../core/types.js';

/**
 * `substrate unapprove <task_id> <field>` — the HUMAN channel for REVOKING a
 * mistaken `substrate approve`. It is `approve` run in reverse: the same
 * resolve-board → `human_only` guard → merge → OCC-write → stamp-event → print
 * pipeline, with the one change being that instead of setting the field it
 * DELETES it from `custom_data`. A guard that checks `exists` (or `eq true`)
 * on that field then re-blocks, because an absent key reads `undefined`.
 *
 * Symmetric with `approve`: same human-only guard (agents have no MCP path to
 * either), same `human:<user>` actor stamp, same optimistic version bump.
 * `unapprove` never MOVES a task — if the task already advanced past the gate on
 * the mistaken approval, it warns that the task is now stranded.
 */

function currentUser(): string {
  try {
    return os.userInfo().username || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * The name of a guard the task now sits PAST, or null. A task is stranded when an
 * active `transition_guard` on its board has `to_group === task.group_id` and a
 * `require` tree that references `field`: revoking `field` re-closes a gate the
 * task already passed, and `unapprove` won't move it back. Direct `to_group`
 * match only (no multi-hop reachability) — a false negative merely omits a
 * warning, it never moves or blocks anything.
 */
function strandedGate(board: Board, task: Task, field: string): string | null {
  for (const policy of board.policies) {
    if (policy.type !== 'transition_guard' || policy.enabled === false || policy.archived_at)
      continue;
    const def = parseGuardDefinition(policy.definition);
    if (!def || def.toGroup !== task.group_id) continue;
    if (collectLeaves(def.require).some((leaf) => taskFieldName(leaf.field) === field))
      return policy.name;
  }
  return null;
}

export async function unapproveCommand(
  cwd: string,
  args: { taskId: string; field: string },
): Promise<void> {
  const root = substrateRootFromCwd(cwd);
  if (!existsSync(root)) {
    throw SubstrateError.notFound(`No .substrate/ in ${cwd}. Run 'substrate init' first.`, { cwd });
  }
  const p = paths(root);
  configureFileSink(p.logFile);
  const client = await openDatabaseAndMigrate(p.dataSqlite);
  try {
    const substrate = await loadSubstrate(root);
    const now = new Date().toISOString();
    const actor = `human:${currentUser()}`;

    const outcome = await withTransaction(client, async (tx) => {
      const task = await getTask(tx, args.taskId); // not_found if missing
      const board = substrate.boards.find((b) => b.id === task.board_id);
      if (!board) {
        throw SubstrateError.notFound(
          `Board '${task.board_id}' for task '${args.taskId}' not found in substrate.`,
          { entity: 'board', id: task.board_id },
        );
      }
      // Human-only guard FIRST — a typo or a non-gate field always errors here,
      // before the idempotency check, so it can never masquerade as an "already
      // cleared" no-op. Mirrors `substrate approve`'s guard wording.
      const entry = board.field_schema.task[args.field];
      if (entry?.human_only !== true) {
        throw SubstrateError.schemaViolation(
          `Field '${args.field}' is not a human-only field on board '${board.id}'. ` +
            `'substrate unapprove' clears human-only gate fields so their gate re-blocks.`,
          { field: args.field },
        );
      }

      // Idempotent no-op: nothing to revoke → no write, no version bump, no event.
      if (!(args.field in task.custom_data)) {
        return { kind: 'noop' as const };
      }

      const oldValue = task.custom_data[args.field];
      const merged = { ...task.custom_data };
      delete merged[args.field];
      // Absent key is always allowed by the validator (deletion path), so this
      // validates cleanly — the write hands `updateTask` the merged blob without
      // the key, the same deletion the MCP handler does for a `null` value.
      validateFieldSchema({
        field_schema: board.field_schema.task,
        merged_custom_data: merged,
        touched_keys: [args.field],
      });
      const result = await updateTask(tx, args.taskId, task.version, { custom_data: merged }, now);
      await appendEvent(tx, {
        task_id: args.taskId,
        event_type: 'updated',
        changes: {
          before: { custom_data: task.custom_data },
          after: { custom_data: merged },
        },
        actor_agent_name: actor,
        occurred_at: now,
      });
      return {
        kind: 'revoked' as const,
        version: result.version,
        oldValue,
        group: task.group_id,
        stranded: strandedGate(board, task, args.field),
      };
    });

    if (outcome.kind === 'noop') {
      process.stdout.write(`Nothing to revoke: ${args.field} is not set on task ${args.taskId}.\n`);
      return;
    }

    process.stdout.write(
      `Revoked: cleared ${args.field} (was ${JSON.stringify(outcome.oldValue)}) on task ${args.taskId} ` +
        `(as ${actor}, version ${outcome.version}).\n`,
    );
    if (outcome.stranded) {
      // No fabricated `substrate move` command — there is no such CLI verb. The
      // task must be moved back on the board (web UI) or by an agent's update_task.
      process.stdout.write(
        `Warning: task ${args.taskId} is in group '${outcome.group}', past the gate that required ${args.field}.\n` +
          `         unapprove does not move tasks — move it back on the board if that was a mistake.\n`,
      );
    }
  } finally {
    client.close();
  }
}
