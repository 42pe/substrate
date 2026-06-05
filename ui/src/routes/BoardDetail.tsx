import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, getBoard, getTasks } from '../lib/api.js';
import { useResource } from '../lib/useResource.js';
import { usePaginated } from '../lib/usePaginated.js';
import { Markdown } from '../components/Markdown.js';
import { Badge } from '../components/ui/Badge.js';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card.js';
import { Table, TBody, TD, TH, THead, TR } from '../components/ui/Table.js';
import { EmptyState, ErrorCard, Loading, NotFound } from '../components/States.js';
import { formatDate } from '../lib/format.js';
import type { Group } from '@core/types';

export function BoardDetail() {
  const { id = '' } = useParams();
  const { data, error, loading } = useResource(() => getBoard(id), [id]);

  if (loading) return <Loading label="Loading board…" />;
  if (error instanceof ApiError && error.status === 404)
    return <NotFound what="board">No board with id “{id}”.</NotFound>;
  if (error) return <ErrorCard error={error} />;
  if (!data) return <ErrorCard error={new Error('Empty board response')} />;

  const { board, groups, field_schema, policies } = data;
  const taskFields = Object.entries(field_schema.task);
  const commentFields = Object.entries(field_schema.comments);

  return (
    <div className="space-y-8">
      <section>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{board.name}</h1>
          {board.archived_at ? <Badge variant="muted">archived</Badge> : null}
        </div>
        {board.description ? (
          <div className="prose prose-sm mt-3 max-w-none text-neutral-700">
            <Markdown source={board.description} />
          </div>
        ) : null}
        <p className="mt-3 font-mono text-xs text-neutral-400">{board.id}</p>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-neutral-500">
          Groups
        </h2>
        {groups.length === 0 ? (
          <p className="text-sm text-neutral-500">No groups.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {[...groups]
              .sort((a, b) => a.position - b.position)
              .map((g) => (
                <Badge key={g.id} variant={g.archived_at ? 'muted' : 'secondary'}>
                  {g.name}
                </Badge>
              ))}
          </div>
        )}
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Field schema</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <FieldList label="Task fields" entries={taskFields} />
            <FieldList label="Comment fields" entries={commentFields} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Policies ({policies.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {policies.length === 0 ? (
              <p className="text-neutral-500">No policies.</p>
            ) : (
              policies.map((pol) => (
                <div key={pol.id} className="border-b border-neutral-100 pb-2 last:border-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{pol.name}</span>
                    <Badge variant="outline">{pol.type}</Badge>
                    {pol.enabled ? null : <Badge variant="muted">disabled</Badge>}
                  </div>
                  {pol.description ? (
                    <div className="prose prose-sm mt-1 max-w-none text-neutral-600">
                      <Markdown source={pol.description} />
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </section>

      <TaskTable boardId={board.id} groups={groups} />
    </div>
  );
}

function FieldList({
  label,
  entries,
}: {
  label: string;
  entries: [string, { type: string; required?: boolean }][];
}) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">{label}</p>
      {entries.length === 0 ? (
        <p className="mt-1 text-neutral-500">None.</p>
      ) : (
        <ul className="mt-1 space-y-0.5">
          {entries.map(([name, def]) => (
            <li key={name} className="flex items-center gap-2">
              <span className="font-mono text-xs">{name}</span>
              <Badge variant="outline">{def.type}</Badge>
              {def.required ? <span className="text-xs text-neutral-400">required</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TaskTable({ boardId, groups }: { boardId: string; groups: Group[] }) {
  const [groupId, setGroupId] = useState('');
  const [archived, setArchived] = useState(false);
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');

  const { items, error, loading, loadingMore, hasMore, loadMore } = usePaginated(
    (cursor) =>
      getTasks({
        board_id: boardId,
        ...(groupId ? { in_groups: groupId } : {}),
        ...(archived ? { archived: true } : {}),
        ...(appliedSearch ? { text_search: appliedSearch } : {}),
        ...(cursor ? { cursor } : {}),
        page_size: 25,
      }),
    [boardId, groupId, archived, appliedSearch],
  );

  const groupName = (gid: string) => groups.find((g) => g.id === gid)?.name ?? gid;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">Tasks</h2>

      <div className="flex flex-wrap items-center gap-3">
        <select
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
          className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
        >
          <option value="">All groups</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-neutral-600">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />
          Archived
        </label>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setAppliedSearch(search.trim());
          }}
        >
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title/description…"
            className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
          />
          <button
            type="submit"
            className="rounded-md border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100"
          >
            Search
          </button>
        </form>
      </div>

      {loading ? (
        <Loading label="Loading tasks…" />
      ) : error ? (
        <ErrorCard error={error} />
      ) : items.length === 0 ? (
        <EmptyState title="No tasks" hint="No tasks match the current filters." />
      ) : (
        <>
          <Card>
            <Table>
              <THead>
                <TR>
                  <TH>Title</TH>
                  <TH>Group</TH>
                  <TH>Updated</TH>
                </TR>
              </THead>
              <TBody>
                {items.map((t) => (
                  <TR key={t.id}>
                    <TD>
                      <Link
                        to={`/tasks/${encodeURIComponent(t.id)}`}
                        className="font-medium text-neutral-900 hover:underline"
                      >
                        {t.title}
                      </Link>
                      {t.archived_at ? (
                        <Badge className="ml-2" variant="muted">
                          archived
                        </Badge>
                      ) : null}
                    </TD>
                    <TD className="text-neutral-600">{groupName(t.group_id)}</TD>
                    <TD className="text-neutral-500">{formatDate(t.updated_at)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
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
        </>
      )}
    </section>
  );
}
