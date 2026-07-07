import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { BoardColumn, ColumnTask } from '../lib/api.js';
import { cn } from '../lib/cn.js';
import { Badge } from './ui/Badge.js';
import { EmptyState } from './States.js';
import { timeAgo } from '../lib/format.js';

/**
 * Read-only kanban primitives (Phase 9). Columns reflect the board's workflow;
 * there is NO drag-and-drop — moving a task is an agent action over MCP, and
 * the inspector observes it via polling. A card that changed column since the
 * last poll gets a one-shot highlight (`animate-card-pulse`).
 */

/**
 * Diff successive column snapshots and return the set of task ids that changed
 * column (or newly appeared) since the previous snapshot. Consumer-side on
 * purpose — the polling hook stays type-agnostic. Returns an empty set on the
 * first snapshot (so the board doesn't pulse every card on initial paint).
 */
export function useMovedTasks(columns: BoardColumn[] | null | undefined): Set<string> {
  const prevRef = useRef<Map<string, string> | null>(null);
  const [moved, setMoved] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!columns) return;
    const next = new Map<string, string>();
    for (const col of columns) {
      for (const t of col.tasks) next.set(t.id, col.group_id);
    }
    const prev = prevRef.current;
    if (prev) {
      const changed = new Set<string>();
      for (const [id, gid] of next) {
        const before = prev.get(id);
        if (before === undefined || before !== gid) changed.add(id);
      }
      setMoved(changed);
    }
    prevRef.current = next;
  }, [columns]);

  return moved;
}

function KanbanCard({ task, moved }: { task: ColumnTask; moved: boolean }) {
  const missing = task.missing_required_fields;
  return (
    <Link
      to={`/tasks/${encodeURIComponent(task.id)}`}
      className={cn(
        'block rounded-lg border border-border bg-card p-3 shadow-sm transition hover:border-input hover:shadow',
        moved && 'animate-card-pulse',
      )}
    >
      <p className="text-sm font-medium text-foreground">{task.title}</p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <p className="text-xs text-muted-foreground">updated {timeAgo(task.updated_at)} ago</p>
        {task.pending_approval ? (
          <Badge
            variant="pending"
            aria-label={`pending human approval: set ${task.awaiting_fields.join(', ')}`}
            title={`Pending human approval — set ${task.awaiting_fields.join(', ')}`}
          >
            pending approval
          </Badge>
        ) : null}
        {missing.length > 0 ? (
          <Badge variant="warning" title={`Missing required: ${missing.join(', ')}`}>
            {missing.length === 1
              ? 'missing 1 required field'
              : `missing ${missing.length} required`}
          </Badge>
        ) : null}
      </div>
    </Link>
  );
}

function KanbanColumn({ column, movedIds }: { column: BoardColumn; movedIds: Set<string> }) {
  const overflow = column.total - column.tasks.length;
  const unit = column.total === 1 ? 'task' : 'tasks';
  return (
    <section
      aria-label={`${column.group_name}, ${column.total} ${unit}`}
      className="flex w-72 shrink-0 flex-col"
    >
      <div
        className="mb-3 flex items-center gap-2 border-b-2 border-border pb-1.5"
        style={column.color ? { borderBottomColor: column.color } : undefined}
      >
        <h3 className="text-sm font-semibold text-foreground">{column.group_name}</h3>
        <Badge variant="secondary">
          <span className="sr-only">{unit}: </span>
          {column.total}
        </Badge>
      </div>
      <ul
        role="list"
        className="flex max-h-[calc(100vh-18rem)] flex-col gap-2 overflow-y-auto pr-1"
      >
        {column.tasks.length === 0 ? (
          <li className="px-1 py-2 text-xs text-muted-foreground">No tasks</li>
        ) : (
          column.tasks.map((t) => (
            <li key={t.id}>
              <KanbanCard task={t} moved={movedIds.has(t.id)} />
            </li>
          ))
        )}
        {overflow > 0 ? (
          <li>
            <Link
              to={`?view=list&group=${encodeURIComponent(column.group_id)}`}
              className="block px-1 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:underline"
            >
              +{overflow} more — open List
            </Link>
          </li>
        ) : null}
      </ul>
    </section>
  );
}

export function KanbanBoard({
  columns,
  movedIds,
}: {
  columns: BoardColumn[];
  movedIds: Set<string>;
}) {
  if (columns.length === 0) {
    return (
      <EmptyState
        title="No groups yet"
        hint="This board has no active groups to show as columns."
      />
    );
  }
  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {columns.map((col) => (
        <KanbanColumn key={col.group_id} column={col} movedIds={movedIds} />
      ))}
    </div>
  );
}
