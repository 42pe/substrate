import { Link, useParams } from 'react-router-dom';
import { ApiError, getComments, getTask, getTaskHistory } from '../lib/api.js';
import { useResource } from '../lib/useResource.js';
import { usePaginated } from '../lib/usePaginated.js';
import { Markdown } from '../components/Markdown.js';
import { Badge } from '../components/ui/Badge.js';
import { Card, CardContent } from '../components/ui/Card.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/Tabs.js';
import { EmptyState, ErrorCard, Loading, NotFound } from '../components/States.js';
import { formatDate, formatValue } from '../lib/format.js';
import type { Comment, TaskEvent } from '@core/types';

export function TaskDetail() {
  const { id = '' } = useParams();
  const { data: task, error, loading } = useResource(() => getTask(id), [id]);

  if (loading) return <Loading label="Loading task…" />;
  if (error instanceof ApiError && error.status === 404)
    return <NotFound what="task">No task with id “{id}”.</NotFound>;
  if (error) return <ErrorCard error={error} />;
  if (!task) return <ErrorCard error={new Error('Empty task response')} />;

  const customEntries = Object.entries(task.custom_data);

  return (
    <div className="space-y-6">
      <section>
        <Link
          to={`/boards/${encodeURIComponent(task.board_id)}`}
          className="text-sm text-neutral-500 hover:underline"
        >
          ← {task.board_id}
        </Link>
        <div className="mt-1 flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{task.title}</h1>
          {task.archived_at ? <Badge variant="muted">archived</Badge> : null}
        </div>
        <div className="mt-2 flex flex-wrap gap-2 text-xs text-neutral-500">
          <Badge variant="outline">group {task.group_id}</Badge>
          <Badge variant="outline">v{task.version}</Badge>
          <span>by {task.created_by_agent}</span>
          <span>· updated {formatDate(task.updated_at)}</span>
        </div>
      </section>

      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="comments">Comments</TabsTrigger>
          <TabsTrigger value="events">Events</TabsTrigger>
        </TabsList>

        <TabsContent value="details">
          <div className="space-y-6">
            <section>
              <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-neutral-500">
                Description
              </h2>
              {task.description ? (
                <Card>
                  <CardContent className="prose prose-sm max-w-none py-4 text-neutral-700">
                    <Markdown source={task.description} />
                  </CardContent>
                </Card>
              ) : (
                <p className="text-sm text-neutral-500">No description.</p>
              )}
            </section>
            <section>
              <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-neutral-500">
                Custom data
              </h2>
              {customEntries.length === 0 ? (
                <p className="text-sm text-neutral-500">No custom fields.</p>
              ) : (
                <Card>
                  <CardContent className="py-4">
                    <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
                      {customEntries.map(([k, v]) => (
                        <div key={k} className="contents">
                          <dt className="font-mono text-xs text-neutral-500">{k}</dt>
                          <dd className="break-words">{formatValue(v)}</dd>
                        </div>
                      ))}
                    </dl>
                  </CardContent>
                </Card>
              )}
            </section>
          </div>
        </TabsContent>

        <TabsContent value="comments">
          <CommentsTab taskId={task.id} />
        </TabsContent>

        <TabsContent value="events">
          <EventsTab taskId={task.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CommentsTab({ taskId }: { taskId: string }) {
  const { items, error, loading, loadingMore, hasMore, loadMore } = usePaginated<Comment>(
    (cursor) => getComments(taskId, cursor ? { cursor } : {}),
    [taskId],
  );

  if (loading) return <Loading label="Loading comments…" />;
  if (error) return <ErrorCard error={error} />;
  if (items.length === 0)
    return <EmptyState title="No comments" hint="This task has no comments yet." />;

  return (
    <div className="space-y-3">
      {items.map((c) => (
        <Card key={c.id} className={c.parent_id ? 'ml-6' : undefined}>
          <CardContent className="py-3">
            <div className="mb-1 flex items-center gap-2 text-xs text-neutral-500">
              <span className="font-medium text-neutral-700">{c.created_by_agent}</span>
              <span>· {formatDate(c.created_at)}</span>
              {c.edited_at ? <span>· edited</span> : null}
              {c.archived_at ? <Badge variant="muted">archived</Badge> : null}
            </div>
            <div className="prose prose-sm max-w-none text-neutral-700">
              <Markdown source={c.body} />
            </div>
          </CardContent>
        </Card>
      ))}
      {hasMore ? (
        <button
          type="button"
          onClick={loadMore}
          disabled={loadingMore}
          className="rounded-md border border-neutral-300 px-4 py-1.5 text-sm hover:bg-neutral-100 disabled:opacity-50"
        >
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      ) : null}
    </div>
  );
}

function EventsTab({ taskId }: { taskId: string }) {
  const { items, error, loading, loadingMore, hasMore, loadMore } = usePaginated<TaskEvent>(
    (cursor) => getTaskHistory(taskId, cursor ? { cursor } : {}),
    [taskId],
  );

  if (loading) return <Loading label="Loading history…" />;
  if (error) return <ErrorCard error={error} />;
  if (items.length === 0)
    return <EmptyState title="No events" hint="No history recorded for this task." />;

  return (
    <div className="space-y-2">
      <ol className="space-y-2">
        {items.map((ev) => (
          <li key={ev.id} className="flex items-start gap-3 text-sm">
            <Badge variant="outline">{ev.event_type}</Badge>
            <div className="min-w-0">
              <span className="text-neutral-700">{ev.actor_agent_name}</span>
              <span className="text-neutral-400"> · {formatDate(ev.occurred_at)}</span>
              {Object.keys(ev.changes).length > 0 ? (
                <pre className="mt-1 overflow-x-auto rounded bg-neutral-50 p-2 text-xs text-neutral-600">
                  {JSON.stringify(ev.changes, null, 2)}
                </pre>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
      {hasMore ? (
        <button
          type="button"
          onClick={loadMore}
          disabled={loadingMore}
          className="rounded-md border border-neutral-300 px-4 py-1.5 text-sm hover:bg-neutral-100 disabled:opacity-50"
        >
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      ) : null}
    </div>
  );
}
