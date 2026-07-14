import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ApiError, getBoard, getBoardColumns, getTasks } from '../lib/api.js';
import { useResource } from '../lib/useResource.js';
import { usePaginated } from '../lib/usePaginated.js';
import { usePolling } from '../lib/usePolling.js';
import { Markdown } from '../components/Markdown.js';
import { Badge } from '../components/ui/Badge.js';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card.js';
import { Table, TBody, TD, TH, THead, TR } from '../components/ui/Table.js';
import { KanbanBoard, useMovedTasks } from '../components/Kanban.js';
import { LiveIndicator } from '../components/LiveIndicator.js';
import { EmptyState, ErrorCard, Loading, NotFound } from '../components/States.js';
import { cn } from '../lib/cn.js';
import { formatDate } from '../lib/format.js';
import type { BoardSubstrate } from '../lib/api.js';
import type { Group } from '@core/types';

type View = 'kanban' | 'list';

export function BoardDetail() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const view: View = params.get('view') === 'list' ? 'list' : 'kanban';
  const groupParam = params.get('group') ?? '';
  const { data, error, loading } = useResource(() => getBoard(id), [id]);

  if (loading) return <Loading label="Loading board…" />;
  if (error instanceof ApiError && error.status === 404)
    return <NotFound what="board">No board with id “{id}”.</NotFound>;
  if (error) return <ErrorCard error={error} />;
  if (!data) return <ErrorCard error={new Error('Empty board response')} />;

  const { board, groups } = data;

  return (
    <div className="space-y-6">
      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{board.name}</h1>
            {board.archived_at ? <Badge variant="muted">archived</Badge> : null}
          </div>
          <ViewToggle view={view} />
        </div>
        <BoardDetailsDisclosure data={data} />
      </section>

      {view === 'list' ? (
        <TaskTable
          key={`list-${groupParam}`}
          boardId={board.id}
          groups={groups}
          initialGroupId={groupParam}
        />
      ) : (
        <KanbanView boardId={board.id} />
      )}
    </div>
  );
}

function ViewToggle({ view }: { view: View }) {
  const base = 'rounded px-3 py-1 text-sm transition';
  return (
    <div className="inline-flex rounded-md border border-input p-0.5">
      <Link
        to="?view=kanban"
        className={cn(
          base,
          view === 'kanban'
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:bg-muted',
        )}
      >
        Board
      </Link>
      <Link
        to="?view=list"
        className={cn(
          base,
          view === 'list'
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:bg-muted',
        )}
      >
        List
      </Link>
    </div>
  );
}

/** Description + field schema + policies, demoted into a collapsed disclosure so
 *  the columns lead. `<details>` is native + accessible; collapsed by default. */
function BoardDetailsDisclosure({ data }: { data: BoardSubstrate }) {
  const { board, field_schema, policies, groups, team } = data;
  const taskFields = Object.entries(field_schema.task);
  const commentFields = Object.entries(field_schema.comments);
  const groupName = (gid: string) => groups.find((g) => g.id === gid)?.name ?? gid;
  return (
    <details className="group mt-3 rounded-lg border border-border bg-card">
      <summary className="cursor-pointer list-none px-4 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground">
        <span className="inline-flex items-center gap-2">
          <span className="text-muted-foreground transition group-open:rotate-90">▸</span>
          Board details — description, field schema, policies
        </span>
      </summary>
      <div className="space-y-6 border-t border-border px-4 py-4">
        {board.description ? (
          <div className="markdown max-w-none text-subtle">
            <Markdown source={board.description} />
          </div>
        ) : null}
        <p className="font-mono text-xs text-muted-foreground">{board.id}</p>
        <div className="grid gap-6 md:grid-cols-2">
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
                <p className="text-muted-foreground">No policies.</p>
              ) : (
                policies.map((pol) => (
                  <div key={pol.id} className="border-b border-border pb-2 last:border-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{pol.name}</span>
                      <Badge variant="outline">{pol.type}</Badge>
                      {pol.enabled ? null : <Badge variant="muted">disabled</Badge>}
                    </div>
                    {pol.description ? (
                      <div className="markdown mt-1 max-w-none text-muted-foreground">
                        <Markdown source={pol.description} />
                      </div>
                    ) : null}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
          <TeamCard team={team} groupName={groupName} />
        </div>
      </div>
    </details>
  );
}

/** The board's roster, resolved from the member registry. `groups` render as
 *  ADVISORY assignment badges (group id → name); traits + concerns as chip-ish
 *  lines; full_description as a secondary line. An unresolved member (dangling
 *  ref) shows its id with a muted "unresolved" marker rather than disappearing.
 *  An empty team shows a muted empty state (matching "No policies."). */
function TeamCard({
  team,
  groupName,
}: {
  team: BoardSubstrate['team'];
  groupName: (gid: string) => string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Team ({team.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {team.length === 0 ? (
          <p className="text-muted-foreground">No team declared.</p>
        ) : (
          team.map((entry) => (
            <div
              key={entry.member.id}
              className="border-b border-border pb-2 last:border-0 last:pb-0"
            >
              <div className="flex flex-wrap items-center gap-2">
                {entry.unresolved ? (
                  <>
                    <span className="font-mono text-xs">{entry.member.id}</span>
                    <Badge variant="muted">unresolved</Badge>
                  </>
                ) : (
                  <span className="font-medium">{entry.member.name}</span>
                )}
                {entry.groups.map((gid) => (
                  <Badge key={gid} variant="outline">
                    {groupName(gid)}
                  </Badge>
                ))}
              </div>
              {!entry.unresolved && entry.member.full_description ? (
                <p className="mt-1 text-muted-foreground">{entry.member.full_description}</p>
              ) : null}
              {!entry.unresolved && entry.member.traits && entry.member.traits.length > 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  <span className="uppercase tracking-wide">Traits:</span>{' '}
                  {entry.member.traits.join(', ')}
                </p>
              ) : null}
              {!entry.unresolved && entry.member.concerns && entry.member.concerns.length > 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  <span className="uppercase tracking-wide">Concerns:</span>{' '}
                  {entry.member.concerns.join(', ')}
                </p>
              ) : null}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function KanbanView({ boardId }: { boardId: string }) {
  // No `limit` → server default cap; the long tail lives in List view.
  const { data, error, loading, paused, reconnecting, lastUpdated } = usePolling(
    () => getBoardColumns(boardId),
    [boardId],
  );
  const movedIds = useMovedTasks(data?.columns);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Board</h2>
        <LiveIndicator paused={paused} reconnecting={reconnecting} lastUpdated={lastUpdated} />
      </div>
      {loading ? (
        <Loading label="Loading board…" />
      ) : error ? (
        <ErrorCard error={error} />
      ) : data ? (
        <KanbanBoard columns={data.columns} movedIds={movedIds} />
      ) : null}
    </section>
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
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      {entries.length === 0 ? (
        <p className="mt-1 text-muted-foreground">None.</p>
      ) : (
        <ul className="mt-1 space-y-0.5">
          {entries.map(([name, def]) => (
            <li key={name} className="flex items-center gap-2">
              <span className="font-mono text-xs">{name}</span>
              <Badge variant="outline">{def.type}</Badge>
              {def.required ? (
                <span className="text-xs text-muted-foreground">required</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TaskTable({
  boardId,
  groups,
  initialGroupId = '',
}: {
  boardId: string;
  groups: Group[];
  initialGroupId?: string;
}) {
  const [groupId, setGroupId] = useState(initialGroupId);
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
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Tasks</h2>

      <div className="flex flex-wrap items-center gap-3">
        <select
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
          className="rounded-md border border-input px-2 py-1 text-sm"
        >
          <option value="">All groups</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
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
            className="rounded-md border border-input px-2 py-1 text-sm"
          />
          <button
            type="submit"
            className="rounded-md border border-input px-3 py-1 text-sm hover:bg-muted"
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
                        className="font-medium text-foreground hover:underline"
                      >
                        {t.title}
                      </Link>
                      {t.archived_at ? (
                        <Badge className="ml-2" variant="muted">
                          archived
                        </Badge>
                      ) : null}
                    </TD>
                    <TD className="text-muted-foreground">{groupName(t.group_id)}</TD>
                    <TD className="text-muted-foreground">{formatDate(t.updated_at)}</TD>
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
              className="rounded-md border border-input px-4 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
