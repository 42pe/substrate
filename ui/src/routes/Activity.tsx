import { Link } from 'react-router-dom';
import { getActivity } from '../lib/api.js';
import type { ActivityEvent } from '../lib/api.js';
import { usePolling } from '../lib/usePolling.js';
import { Badge } from '../components/ui/Badge.js';
import { LiveIndicator } from '../components/LiveIndicator.js';
import { EmptyState, ErrorCard, Loading } from '../components/States.js';
import { formatDate } from '../lib/format.js';

/**
 * Project-wide activity feed (Theme 4a) — a live, cross-board "who did what,
 * when" stream over `GET /api/activity`. Read-only, like the rest of the
 * inspector: it observes the event log the agents write. Shows the most recent
 * page and polls it live (older history is per-task via the task's Events tab).
 */

/** Event types worth calling out with colour; the rest read as neutral. */
function badgeVariant(eventType: string): 'warning' | 'secondary' {
  return eventType === 'move_blocked' ? 'warning' : 'secondary';
}

/** A compact one-line detail for an event, or null if the type/badge says it all. */
function detail(ev: ActivityEvent): string | null {
  const c = ev.changes as Record<string, unknown>;
  if (ev.event_type === 'move_blocked') {
    const msg = typeof c['message'] === 'string' ? c['message'] : 'move blocked by a guard';
    return msg;
  }
  const fired = c['policies_fired'];
  if (Array.isArray(fired) && fired.length > 0) {
    const names = fired
      .map((p) => (p as { policy_name?: string }).policy_name)
      .filter((n): n is string => typeof n === 'string');
    if (names.length > 0) return `policies engaged: ${names.join(', ')}`;
  }
  return null;
}

function ActivityRow({ ev }: { ev: ActivityEvent }) {
  const note = detail(ev);
  return (
    <li className="flex items-start gap-3 border-b border-border py-3 text-sm last:border-b-0">
      <Badge variant={badgeVariant(ev.event_type)}>{ev.event_type}</Badge>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-medium text-subtle">{ev.actor_agent_name}</span>
          <span className="text-muted-foreground">·</span>
          {ev.task_title !== null ? (
            <Link
              to={`/tasks/${encodeURIComponent(ev.task_id)}`}
              className="truncate font-medium text-foreground hover:underline"
            >
              {ev.task_title}
            </Link>
          ) : (
            <span className="text-muted-foreground">(task removed)</span>
          )}
          {ev.board_name !== null && ev.board_id !== null ? (
            <>
              <span className="text-muted-foreground">in</span>
              <Link
                to={`/boards/${encodeURIComponent(ev.board_id)}`}
                className="text-muted-foreground hover:underline"
              >
                {ev.board_name}
              </Link>
            </>
          ) : null}
          <span className="text-muted-foreground">· {formatDate(ev.occurred_at)}</span>
        </div>
        {note ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{note}</p> : null}
      </div>
    </li>
  );
}

export function Activity() {
  const { data, error, loading, paused, reconnecting, lastUpdated } = usePolling(
    () => getActivity(),
    [],
  );

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            What agents did across every board — newest first.
          </p>
        </div>
        <LiveIndicator paused={paused} reconnecting={reconnecting} lastUpdated={lastUpdated} />
      </div>

      {loading ? (
        <Loading label="Loading activity…" />
      ) : error ? (
        <ErrorCard error={error} />
      ) : !data || data.results.length === 0 ? (
        <EmptyState
          title="No activity yet"
          hint="Task and policy events appear here as agents work through the substrate."
        />
      ) : (
        <>
          <ol>
            {data.results.map((ev) => (
              <ActivityRow key={ev.id} ev={ev} />
            ))}
          </ol>
          {data.pagination.has_more ? (
            <p className="pt-2 text-xs text-muted-foreground">
              Showing the {data.results.length} most recent events. Older history is on each task’s
              Events tab.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
