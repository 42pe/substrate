import type { Comment } from '../../core/types.js';
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
 * Comments repository.
 *
 * Comments are append-only with last-write-wins on edits — NO version column,
 * so no OCC (design doc §Concurrency). Functions take an `Executor`; the
 * handler owns any transaction. Parameterized queries only.
 */

type CommentRow = {
  id: string;
  task_id: string;
  parent_id: string | null;
  body: string;
  custom_data: string;
  created_by_agent: string;
  created_at: string;
  edited_at: string | null;
  archived_at: string | null;
};

function rowToComment(row: CommentRow): Comment {
  let custom: Record<string, unknown>;
  try {
    custom = JSON.parse(row.custom_data) as Record<string, unknown>;
  } catch (e) {
    throw SubstrateError.internalError(
      `Corrupt custom_data for comment ${row.id}: ${(e as Error).message}`,
      { comment_id: row.id },
    );
  }
  return {
    id: row.id,
    task_id: row.task_id,
    parent_id: row.parent_id,
    body: row.body,
    custom_data: custom,
    created_by_agent: row.created_by_agent,
    created_at: row.created_at,
    edited_at: row.edited_at,
    archived_at: row.archived_at,
  };
}

export async function createComment(exec: Executor, comment: Comment): Promise<Comment> {
  await exec.execute({
    sql: `
      INSERT INTO comments (
        id, task_id, parent_id, body, custom_data,
        created_by_agent, created_at, edited_at, archived_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      comment.id,
      comment.task_id,
      comment.parent_id,
      comment.body,
      JSON.stringify(comment.custom_data),
      comment.created_by_agent,
      comment.created_at,
      comment.edited_at,
      comment.archived_at,
    ],
  });
  return comment;
}

export async function getComment(exec: Executor, id: string): Promise<Comment> {
  const result = await exec.execute({ sql: 'SELECT * FROM comments WHERE id = ?', args: [id] });
  const row = result.rows[0];
  if (!row) {
    throw SubstrateError.notFound(`Comment ${id} not found`, { entity: 'comment', id });
  }
  return rowToComment(row as unknown as CommentRow);
}

export interface CommentPatch {
  body?: string;
  custom_data?: Record<string, unknown>;
}

/**
 * Edit a comment. Last-write-wins — NO version check (design doc). Sets
 * `edited_at`. Returns the post-edit comment. Throws `not_found` if missing.
 */
export async function editComment(
  exec: Executor,
  id: string,
  patch: CommentPatch,
  now: string,
): Promise<Comment> {
  const current = await getComment(exec, id);
  const sets: string[] = ['edited_at = ?'];
  const args: Array<string | null> = [now];
  if (patch.body !== undefined) {
    sets.push('body = ?');
    args.push(patch.body);
  }
  if (patch.custom_data !== undefined) {
    sets.push('custom_data = ?');
    args.push(JSON.stringify(patch.custom_data));
  }
  args.push(id);
  await exec.execute({ sql: `UPDATE comments SET ${sets.join(', ')} WHERE id = ?`, args });
  return {
    ...current,
    ...(patch.body !== undefined ? { body: patch.body } : {}),
    ...(patch.custom_data !== undefined ? { custom_data: patch.custom_data } : {}),
    edited_at: now,
  };
}

export interface CommentArchiveResult {
  comment: Comment;
  changed: boolean;
}

/** Archive a comment (idempotent — no-op + changed:false if already archived). */
export async function archiveComment(
  exec: Executor,
  id: string,
  now: string,
): Promise<CommentArchiveResult> {
  const current = await getComment(exec, id);
  if (current.archived_at !== null) {
    return { comment: current, changed: false };
  }
  await exec.execute({
    sql: 'UPDATE comments SET archived_at = ? WHERE id = ?',
    args: [now, id],
  });
  return { comment: { ...current, archived_at: now }, changed: true };
}

export interface ListCommentsFilters {
  parent_id?: string | null | undefined;
  since?: string | undefined;
  until?: string | undefined;
}

/** List a task's comments oldest-first, paginated. Active (non-archived) only. */
export async function listComments(
  exec: Executor,
  taskId: string,
  filters: ListCommentsFilters = {},
  pagination?: PaginationInput,
): Promise<{ results: Comment[]; pagination: PaginationOutput }> {
  const where: string[] = ['task_id = ?', 'archived_at IS NULL'];
  const args: Array<string | number | null> = [taskId];

  if (filters.parent_id !== undefined) {
    if (filters.parent_id === null) {
      where.push('parent_id IS NULL');
    } else {
      where.push('parent_id = ?');
      args.push(filters.parent_id);
    }
  }
  if (filters.since !== undefined) {
    where.push('created_at >= ?');
    args.push(filters.since);
  }
  if (filters.until !== undefined) {
    where.push('created_at <= ?');
    args.push(filters.until);
  }

  if (pagination?.cursor) {
    const cur = decodeCursor<string>(pagination.cursor);
    where.push('(created_at > ? OR (created_at = ? AND id > ?))');
    args.push(cur.u, cur.u, cur.i);
  }

  const pageSize = pagination?.page_size ?? DEFAULT_PAGE_SIZE;
  const result = await exec.execute({
    sql: `SELECT * FROM comments WHERE ${where.join(' AND ')} ORDER BY created_at ASC, id ASC LIMIT ?`,
    args: [...args, pageSize + 1],
  });

  const rows = result.rows as unknown as CommentRow[];
  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;
  const comments = page.map(rowToComment);

  let nextCursor: string | null = null;
  if (hasMore && page.length > 0) {
    const last = page[page.length - 1]!;
    const tuple: CursorTuple<string> = { u: last.created_at, i: last.id };
    nextCursor = encodeCursor(tuple);
  }

  return {
    results: comments,
    pagination: { next_cursor: nextCursor, has_more: hasMore, page_size: pageSize },
  };
}
