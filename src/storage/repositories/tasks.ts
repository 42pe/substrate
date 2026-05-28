import type { Task } from '../../core/types.js';
import { SubstrateError } from '../../core/errors.js';
import type { Executor } from '../client.js';
import {
  type PaginationOutput,
  type PaginationInput,
  type CursorTuple,
  encodeCursor,
  decodeCursor,
  DEFAULT_PAGE_SIZE,
} from '../../core/pagination.js';

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

/** Fields an `updateTask` may change. `custom_data` is the FULLY-MERGED blob
 *  (partial-merge + null-deletion happen in the handler, not here). */
export interface TaskPatch {
  title?: string;
  description?: string;
  custom_data?: Record<string, unknown>;
  group_id?: string;
}

const VERSION_MISMATCH_MESSAGE =
  'This task has been updated since you last read it. Call get_task to re-read, ' +
  'reconcile any conflicts, then retry with the new version.';

/**
 * Update a task with optimistic concurrency control.
 *
 * Throws `not_found` if missing, `conflict` if archived, `version_mismatch`
 * if the caller's version is stale (NO `current_version` in details — forces
 * a re-read, per PRD §6.11). Bumps `version` and `updated_at`. Returns the
 * post-update task.
 *
 * Defense-in-depth OCC: a SELECT-check for clean error codes, plus a
 * version-CAS on the UPDATE (`WHERE version = ?`) so a write that slips in
 * between the SELECT and UPDATE still fails closed. (Gold-plating retained
 * per the 2026-05-28 decision.)
 */
export async function updateTask(
  exec: Executor,
  id: string,
  expectedVersion: number,
  patch: TaskPatch,
  now: string,
): Promise<Task> {
  const current = await getTask(exec, id);
  if (current.archived_at !== null) {
    throw SubstrateError.conflict(`Task ${id} is archived. Unarchive it before updating.`, {
      entity: 'task',
      id,
    });
  }
  if (current.version !== expectedVersion) {
    throw SubstrateError.versionMismatch(VERSION_MISMATCH_MESSAGE, { id });
  }

  const sets: string[] = ['version = version + 1', 'updated_at = ?'];
  const args: Array<string | null> = [now];
  if (patch.title !== undefined) {
    sets.push('title = ?');
    args.push(patch.title);
  }
  if (patch.description !== undefined) {
    sets.push('description = ?');
    args.push(patch.description);
  }
  if (patch.group_id !== undefined) {
    sets.push('group_id = ?');
    args.push(patch.group_id);
  }
  if (patch.custom_data !== undefined) {
    sets.push('custom_data = ?');
    args.push(JSON.stringify(patch.custom_data));
  }
  args.push(id, String(expectedVersion));

  const result = await exec.execute({
    sql: `UPDATE tasks SET ${sets.join(', ')} WHERE id = ? AND version = ?`,
    args,
  });
  if (result.rowsAffected === 0) {
    throw SubstrateError.versionMismatch(VERSION_MISMATCH_MESSAGE, { id });
  }

  return {
    ...current,
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.group_id !== undefined ? { group_id: patch.group_id } : {}),
    ...(patch.custom_data !== undefined ? { custom_data: patch.custom_data } : {}),
    version: current.version + 1,
    updated_at: now,
  };
}

/** Result of an archive/unarchive: the task plus whether state actually
 *  changed (so the handler knows whether to emit an event — idempotent
 *  no-ops emit none, per spec §6 Q1). */
export interface ArchiveResult {
  task: Task;
  changed: boolean;
}

/**
 * Archive a task (soft delete). Idempotent: if already archived, returns the
 * current task with `changed: false`, no version bump, no error — even on a
 * stale version (a no-op needs no OCC). On an actual archive, OCC applies.
 */
export async function archiveTask(
  exec: Executor,
  id: string,
  expectedVersion: number,
  now: string,
): Promise<ArchiveResult> {
  const current = await getTask(exec, id);
  if (current.archived_at !== null) {
    return { task: current, changed: false };
  }
  if (current.version !== expectedVersion) {
    throw SubstrateError.versionMismatch(VERSION_MISMATCH_MESSAGE, { id });
  }
  const result = await exec.execute({
    sql: 'UPDATE tasks SET archived_at = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?',
    args: [now, now, id, String(expectedVersion)],
  });
  if (result.rowsAffected === 0) {
    throw SubstrateError.versionMismatch(VERSION_MISMATCH_MESSAGE, { id });
  }
  return {
    task: { ...current, archived_at: now, version: current.version + 1, updated_at: now },
    changed: true,
  };
}

/**
 * Restore an archived task. Idempotent: if not archived, returns the current
 * task with `changed: false`, no version bump.
 */
export async function unarchiveTask(
  exec: Executor,
  id: string,
  expectedVersion: number,
  now: string,
): Promise<ArchiveResult> {
  const current = await getTask(exec, id);
  if (current.archived_at === null) {
    return { task: current, changed: false };
  }
  if (current.version !== expectedVersion) {
    throw SubstrateError.versionMismatch(VERSION_MISMATCH_MESSAGE, { id });
  }
  const result = await exec.execute({
    sql: 'UPDATE tasks SET archived_at = NULL, version = version + 1, updated_at = ? WHERE id = ? AND version = ?',
    args: [now, id, String(expectedVersion)],
  });
  if (result.rowsAffected === 0) {
    throw SubstrateError.versionMismatch(VERSION_MISMATCH_MESSAGE, { id });
  }
  return {
    task: { ...current, archived_at: null, version: current.version + 1, updated_at: now },
    changed: true,
  };
}

// --- list_tasks ------------------------------------------------------------

export type CustomFieldOp =
  | 'exists'
  | 'not_exists'
  | 'is_empty'
  | 'not_empty'
  | 'eq'
  | 'neq'
  | 'in'
  | 'not_in'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains';

export interface ListTasksFilters {
  board_id?: string;
  in_groups?: string[];
  not_in_groups?: string[];
  parent_id?: string | null;
  has_subtasks?: boolean;
  /** Omitted ⇒ active only (archived_at IS NULL). true ⇒ archived only.
   *  false ⇒ active only. (No "show all" in v1.) */
  archived?: boolean;
  created_before?: string;
  created_after?: string;
  updated_before?: string;
  updated_after?: string;
  custom_field?: { field: string; op: CustomFieldOp; value?: unknown; values?: unknown[] };
  text_search?: string;
}

export interface ListTasksOptions {
  filters: ListTasksFilters;
  sort?: { field: 'created_at' | 'updated_at'; direction: 'asc' | 'desc' };
  pagination?: PaginationInput;
  /** Required-field keys derived from the board's field_schema by the
   *  handler. When provided, restricts to tasks missing at least one. */
  requiredTaskFields?: string[];
}

type SqlArg = string | number | null;

function coerceCustomValue(v: unknown): SqlArg {
  if (v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number' || typeof v === 'string') return v;
  // Objects/arrays compared against a scalar json_extract never match; stringify.
  return JSON.stringify(v);
}

export async function listTasks(
  exec: Executor,
  opts: ListTasksOptions,
): Promise<{ results: Task[]; pagination: PaginationOutput }> {
  const f = opts.filters;
  const where: string[] = [];
  const args: SqlArg[] = [];

  if (f.board_id !== undefined) {
    where.push('board_id = ?');
    args.push(f.board_id);
  }
  if (f.in_groups && f.in_groups.length > 0) {
    where.push(`group_id IN (${f.in_groups.map(() => '?').join(', ')})`);
    args.push(...f.in_groups);
  }
  if (f.not_in_groups && f.not_in_groups.length > 0) {
    where.push(`group_id NOT IN (${f.not_in_groups.map(() => '?').join(', ')})`);
    args.push(...f.not_in_groups);
  }
  if (f.parent_id !== undefined) {
    if (f.parent_id === null) {
      where.push('parent_id IS NULL');
    } else {
      where.push('parent_id = ?');
      args.push(f.parent_id);
    }
  }
  if (f.has_subtasks !== undefined) {
    where.push(
      f.has_subtasks
        ? 'EXISTS (SELECT 1 FROM tasks c WHERE c.parent_id = tasks.id)'
        : 'NOT EXISTS (SELECT 1 FROM tasks c WHERE c.parent_id = tasks.id)',
    );
  }
  // archived: omitted or false ⇒ active only; true ⇒ archived only.
  if (f.archived === true) {
    where.push('archived_at IS NOT NULL');
  } else {
    where.push('archived_at IS NULL');
  }
  if (f.created_before !== undefined) {
    where.push('created_at < ?');
    args.push(f.created_before);
  }
  if (f.created_after !== undefined) {
    where.push('created_at > ?');
    args.push(f.created_after);
  }
  if (f.updated_before !== undefined) {
    where.push('updated_at < ?');
    args.push(f.updated_before);
  }
  if (f.updated_after !== undefined) {
    where.push('updated_at > ?');
    args.push(f.updated_after);
  }
  if (f.custom_field) {
    const path = `$.${f.custom_field.field}`;
    const op = f.custom_field.op;
    if (op === 'exists') {
      where.push('json_extract(custom_data, ?) IS NOT NULL');
      args.push(path);
    } else if (op === 'not_exists') {
      where.push('json_extract(custom_data, ?) IS NULL');
      args.push(path);
    } else if (op === 'is_empty') {
      where.push("(json_extract(custom_data, ?) IS NULL OR json_extract(custom_data, ?) = '')");
      args.push(path, path);
    } else if (op === 'not_empty') {
      where.push(
        "(json_extract(custom_data, ?) IS NOT NULL AND json_extract(custom_data, ?) != '')",
      );
      args.push(path, path);
    } else if (op === 'in' || op === 'not_in') {
      const vals = f.custom_field.values ?? [];
      const placeholders = vals.map(() => '?').join(', ');
      where.push(`json_extract(custom_data, ?) ${op === 'in' ? 'IN' : 'NOT IN'} (${placeholders})`);
      args.push(path, ...vals.map(coerceCustomValue));
    } else if (op === 'contains') {
      where.push('json_extract(custom_data, ?) LIKE ?');
      args.push(path, `%${String(f.custom_field.value ?? '')}%`);
    } else {
      // eq, neq, gt, gte, lt, lte
      const sqlOp = { eq: '=', neq: '!=', gt: '>', gte: '>=', lt: '<', lte: '<=' }[op];
      where.push(`json_extract(custom_data, ?) ${sqlOp} ?`);
      args.push(path, coerceCustomValue(f.custom_field.value));
    }
  }
  if (f.text_search !== undefined && f.text_search !== '') {
    where.push('(title LIKE ? COLLATE NOCASE OR description LIKE ? COLLATE NOCASE)');
    const term = `%${f.text_search}%`;
    args.push(term, term);
  }
  if (opts.requiredTaskFields && opts.requiredTaskFields.length > 0) {
    // missing_required_fields: at least one required key is null/absent.
    // Bind each JSON path as an ARG — never interpolate the field name into SQL.
    const clauses = opts.requiredTaskFields.map(() => 'json_extract(custom_data, ?) IS NULL');
    where.push(`(${clauses.join(' OR ')})`);
    args.push(...opts.requiredTaskFields.map((k) => `$.${k}`));
  }

  const sortField = opts.sort?.field ?? 'updated_at';
  const direction = opts.sort?.direction ?? 'desc';
  const cmp = direction === 'asc' ? '>' : '<';
  const orderDir = direction === 'asc' ? 'ASC' : 'DESC';

  if (opts.pagination?.cursor) {
    const cur = decodeCursor<string>(opts.pagination.cursor);
    // Keyset: (sortField, id) strictly after the cursor in the sort direction.
    where.push(`(${sortField} ${cmp} ? OR (${sortField} = ? AND id ${cmp} ?))`);
    args.push(cur.u, cur.u, cur.i);
  }

  const pageSize = opts.pagination?.page_size ?? DEFAULT_PAGE_SIZE;
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const sql = `SELECT * FROM tasks ${whereSql} ORDER BY ${sortField} ${orderDir}, id ${orderDir} LIMIT ?`;
  const result = await exec.execute({ sql, args: [...args, pageSize + 1] });

  const rows = result.rows as unknown as TaskRow[];
  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;
  const tasks = page.map(rowToTask);

  let nextCursor: string | null = null;
  if (hasMore && page.length > 0) {
    const last = page[page.length - 1]!;
    const tuple: CursorTuple<string> = {
      u: sortField === 'created_at' ? last.created_at : last.updated_at,
      i: last.id,
    };
    nextCursor = encodeCursor(tuple);
  }

  return {
    results: tasks,
    pagination: { next_cursor: nextCursor, has_more: hasMore, page_size: pageSize },
  };
}
