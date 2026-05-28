import type { Task } from '../../core/types.js';
import { SubstrateError } from '../../core/errors.js';
import type { Executor } from '../client.js';

/**
 * Tasks repository.
 *
 * Functions take an `Executor` (Client | Transaction) so the same code path
 * serves non-transactional reads (pass the Client) and atomic write
 * sequences (pass a Transaction). Repos NEVER open their own transaction —
 * the handler owns it via `withTransaction`.
 *
 * Always uses parameterized queries (libsql `{ sql, args }` form). Never
 * raw-concatenates SQL strings (workflow.md §Conventions).
 *
 * Phase 1 shipped createTask + getTask. Step 2 adds update/archive/list.
 */

/**
 * The shape of a row as it comes back from libsql for the `tasks` table.
 * Values can be null, strings, numbers, or bigints depending on the
 * underlying column type.
 */
type TaskRow = {
  id: string;
  board_id: string;
  group_id: string;
  parent_id: string | null;
  origin_task_id: string | null;
  title: string;
  description: string;
  custom_data: string;
  version: number | bigint;
  created_by_agent: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

function coerceVersion(raw: unknown, taskId: string): number {
  if (typeof raw === 'bigint') return Number(raw);
  if (typeof raw === 'number') return raw;
  throw SubstrateError.internalError(
    `Task ${taskId} has invalid version field (${typeof raw}); expected number or bigint.`,
    { task_id: taskId, version_typeof: typeof raw },
  );
}

function rowToTask(row: TaskRow): Task {
  let custom: Record<string, unknown>;
  try {
    custom = JSON.parse(row.custom_data) as Record<string, unknown>;
  } catch (e) {
    throw SubstrateError.internalError(
      `Corrupt custom_data for task ${row.id}: ${(e as Error).message}`,
      { task_id: row.id },
    );
  }
  return {
    id: row.id,
    board_id: row.board_id,
    group_id: row.group_id,
    parent_id: row.parent_id,
    origin_task_id: row.origin_task_id,
    title: row.title,
    description: row.description,
    custom_data: custom,
    version: coerceVersion(row.version, row.id),
    created_by_agent: row.created_by_agent,
    created_at: row.created_at,
    updated_at: row.updated_at,
    archived_at: row.archived_at,
  };
}

/**
 * Insert a task row. Returns the task as written (the input, unchanged in
 * Phase 1 since no server-side derivation happens here).
 */
export async function createTask(exec: Executor, task: Task): Promise<Task> {
  await exec.execute({
    sql: `
      INSERT INTO tasks (
        id, board_id, group_id, parent_id, origin_task_id,
        title, description, custom_data, version,
        created_by_agent, created_at, updated_at, archived_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      task.id,
      task.board_id,
      task.group_id,
      task.parent_id,
      task.origin_task_id,
      task.title,
      task.description,
      JSON.stringify(task.custom_data),
      task.version,
      task.created_by_agent,
      task.created_at,
      task.updated_at,
      task.archived_at,
    ],
  });
  return task;
}

/**
 * Read a task by id. Throws `SubstrateError.notFound` if no row matches.
 */
export async function getTask(exec: Executor, id: string): Promise<Task> {
  const result = await exec.execute({
    sql: 'SELECT * FROM tasks WHERE id = ?',
    args: [id],
  });
  const row = result.rows[0];
  if (!row) {
    throw SubstrateError.notFound(`Task ${id} not found`, { task_id: id });
  }
  return rowToTask(row as unknown as TaskRow);
}
