import type { TaskEvent, TaskEventType } from '../../core/types.js';
import { SubstrateError } from '../../core/errors.js';
import type { Executor } from '../client.js';
import {
  type PaginationOutput,
  type CursorTuple,
  encodeCursor,
  decodeCursor,
  DEFAULT_PAGE_SIZE,
} from '../../core/pagination.js';

/**
 * TaskEvents repository — append-only audit + change feed.
 *
 * `id` is an INTEGER rowid assigned by SQLite (AUTOINCREMENT), so ordering
 * is free and deterministic even when `occurred_at` timestamps tie at
 * millisecond resolution. Events are emitted inside the same transaction as
 * the write they record (the handler owns the tx) so a crash never leaves a
 * write with no audit entry.
 */

type EventRow = {
  id: number | bigint;
  task_id: string;
  event_type: string;
  changes: string;
  actor_agent_name: string;
  occurred_at: string;
};

function coerceId(raw: number | bigint): number {
  return typeof raw === 'bigint' ? Number(raw) : raw;
}

function rowToEvent(row: EventRow): TaskEvent {
  let changes: Record<string, unknown>;
  try {
    changes = JSON.parse(row.changes) as Record<string, unknown>;
  } catch (e) {
    throw SubstrateError.internalError(
      `Corrupt changes JSON for task_event ${String(row.id)}: ${(e as Error).message}`,
      { event_id: coerceId(row.id) },
    );
  }
  return {
    id: coerceId(row.id),
    task_id: row.task_id,
    event_type: row.event_type as TaskEventType,
    changes,
    actor_agent_name: row.actor_agent_name,
    occurred_at: row.occurred_at,
  };
}

/** Input for appending an event — `id` is assigned by SQLite. */
export interface NewTaskEvent {
  task_id: string;
  event_type: TaskEventType;
  changes: Record<string, unknown>;
  actor_agent_name: string;
  occurred_at: string;
}

/** Append an event. Returns the persisted event including its assigned id. */
export async function appendEvent(exec: Executor, event: NewTaskEvent): Promise<TaskEvent> {
  const result = await exec.execute({
    sql: `
      INSERT INTO task_events (task_id, event_type, changes, actor_agent_name, occurred_at)
      VALUES (?, ?, ?, ?, ?)
      RETURNING id
    `,
    args: [
      event.task_id,
      event.event_type,
      JSON.stringify(event.changes),
      event.actor_agent_name,
      event.occurred_at,
    ],
  });
  const idRaw = (result.rows[0] as Record<string, unknown> | undefined)?.['id'];
  const id =
    typeof idRaw === 'bigint' ? Number(idRaw) : typeof idRaw === 'number' ? idRaw : Number(idRaw);
  return { id, ...event };
}

export interface ListEventsFilters {
  event_types?: TaskEventType[];
  since?: string;
  until?: string;
}

/** List a task's events oldest-first (occurred_at, then id tiebreaker). */
export async function listEvents(
  exec: Executor,
  taskId: string,
  filters: ListEventsFilters = {},
  pagination?: { cursor?: string; page_size?: number },
): Promise<{ results: TaskEvent[]; pagination: PaginationOutput }> {
  const where: string[] = ['task_id = ?'];
  const args: Array<string | number | null> = [taskId];

  if (filters.event_types && filters.event_types.length > 0) {
    where.push(`event_type IN (${filters.event_types.map(() => '?').join(', ')})`);
    args.push(...filters.event_types);
  }
  if (filters.since !== undefined) {
    where.push('occurred_at >= ?');
    args.push(filters.since);
  }
  if (filters.until !== undefined) {
    where.push('occurred_at <= ?');
    args.push(filters.until);
  }

  if (pagination?.cursor) {
    const cur = decodeCursor<number>(pagination.cursor);
    // id is the reliable monotonic key; occurred_at can tie.
    where.push('(occurred_at > ? OR (occurred_at = ? AND id > ?))');
    args.push(cur.u, cur.u, cur.i);
  }

  const pageSize = pagination?.page_size ?? DEFAULT_PAGE_SIZE;
  const result = await exec.execute({
    sql: `SELECT * FROM task_events WHERE ${where.join(' AND ')} ORDER BY occurred_at ASC, id ASC LIMIT ?`,
    args: [...args, pageSize + 1],
  });

  const rows = result.rows as unknown as EventRow[];
  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;
  const events = page.map(rowToEvent);

  let nextCursor: string | null = null;
  if (hasMore && page.length > 0) {
    const last = page[page.length - 1]!;
    const tuple: CursorTuple<number> = { u: last.occurred_at, i: coerceId(last.id) };
    nextCursor = encodeCursor(tuple);
  }

  return {
    results: events,
    pagination: { next_cursor: nextCursor, has_more: hasMore, page_size: pageSize },
  };
}
