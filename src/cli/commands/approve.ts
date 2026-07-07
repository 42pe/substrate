import { existsSync } from 'node:fs';
import os from 'node:os';
import { substrateRootFromCwd, paths } from '../../shared/paths.js';
import { configureFileSink } from '../../shared/logger.js';
import { openDatabaseAndMigrate, withTransaction } from '../../storage/client.js';
import { loadSubstrate } from '../../substrate/loader.js';
import { getTask, updateTask } from '../../storage/repositories/tasks.js';
import { appendEvent } from '../../storage/repositories/events.js';
import { validateFieldSchema } from '../../substrate/field-validator.js';
import { SubstrateError } from '../../core/errors.js';

/**
 * `substrate approve <task_id> <field> [value]` — the HUMAN channel for setting a
 * `human_only` field (B3). Agents' MCP write tools refuse these fields, so this
 * CLI (run by a human) is how an approval field gets set — which is what makes a
 * `transition_guard` requiring it a real human gate rather than an honor-system
 * one an autonomous agent could self-satisfy. The write is stamped with a
 * `human:<user>` actor so the activity trail attributes it to a person.
 *
 * `value` defaults to `true` (the approval case). A provided value is parsed as
 * JSON when possible (`true`/`false`/`42`/`"note"`), else taken as a string.
 */
function parseValue(raw: string | undefined): unknown {
  if (raw === undefined) return true;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function currentUser(): string {
  try {
    return os.userInfo().username || 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function approveCommand(
  cwd: string,
  args: { taskId: string; field: string; value?: string },
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
    const value = parseValue(args.value);
    const actor = `human:${currentUser()}`;

    const updated = await withTransaction(client, async (tx) => {
      const task = await getTask(tx, args.taskId); // not_found if missing
      const board = substrate.boards.find((b) => b.id === task.board_id);
      if (!board) {
        throw SubstrateError.notFound(
          `Board '${task.board_id}' for task '${args.taskId}' not found in substrate.`,
          { entity: 'board', id: task.board_id },
        );
      }
      const entry = board.field_schema.task[args.field];
      if (entry?.human_only !== true) {
        throw SubstrateError.schemaViolation(
          `Field '${args.field}' is not a human-only field on board '${board.id}'. ` +
            `'substrate approve' sets human-only gate fields; agents set the rest via update_task.`,
          { field: args.field },
        );
      }
      const merged = { ...task.custom_data, [args.field]: value };
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
      return result;
    });

    process.stdout.write(
      `Approved: set ${args.field} = ${JSON.stringify(value)} on task ${args.taskId} ` +
        `(as ${actor}, version ${updated.version}).\n`,
    );
  } finally {
    client.close();
  }
}
