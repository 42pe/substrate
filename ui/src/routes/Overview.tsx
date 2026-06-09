import { Link } from 'react-router-dom';
import { getBoardColumns, getBoards, getProject } from '../lib/api.js';
import type { BoardColumn, BoardSummary } from '../lib/api.js';
import { useResource } from '../lib/useResource.js';
import { usePolling } from '../lib/usePolling.js';
import { Markdown } from '../components/Markdown.js';
import { Badge } from '../components/ui/Badge.js';
import { LiveIndicator } from '../components/LiveIndicator.js';
import { EmptyState, ErrorCard, Loading } from '../components/States.js';

/** Cards shown per column on the glance wall; the full board has the rest. */
const OVERVIEW_PREVIEW_LIMIT = 4;

export function Overview() {
  const project = useResource(() => getProject(), []);
  const boards = useResource(() => getBoards({ archived: false }), []);

  if (project.loading) return <Loading />;
  if (project.error) return <ErrorCard error={project.error} />;
  const p = project.data;
  if (!p) return <ErrorCard error={new Error('Empty project response')} />;

  return (
    <div className="space-y-8">
      <section>
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Project</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{p.project_name}</h1>
        {p.description ? (
          <div className="prose prose-sm mt-3 max-w-none text-neutral-700">
            <Markdown source={p.description} />
          </div>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          <Badge variant="outline">schema v{p.schema_version}</Badge>
          <Badge variant="outline">version {p.version}</Badge>
          <Badge variant="muted">{p.project_id}</Badge>
        </div>
      </section>

      {boards.loading ? (
        <Loading label="Loading boards…" />
      ) : boards.error ? (
        <ErrorCard error={boards.error} />
      ) : !boards.data || boards.data.results.length === 0 ? (
        <EmptyState title="No boards yet" hint="Create a board via the MCP tools to see it here." />
      ) : (
        <BoardWall boards={boards.data.results} />
      )}
    </div>
  );
}

interface WallEntry {
  board: BoardSummary;
  columns: BoardColumn[] | null; // null ⇒ this board's fetch failed
}

function BoardWall({ boards }: { boards: BoardSummary[] }) {
  // One poll tick refreshes the whole wall. Bounded by BOARD COUNT, not task
  // count: each board does its own loadSubstrate + count/preview query (the
  // accepted cost of not building a single /api/overview aggregate).
  // Promise.allSettled isolates a failing board so the rest still render.
  const idsKey = boards.map((b) => b.id).join(',');
  const { data, loading, error, paused, reconnecting, lastUpdated } = usePolling<WallEntry[]>(
    async () => {
      const settled = await Promise.allSettled(
        boards.map((b) => getBoardColumns(b.id, { limit: OVERVIEW_PREVIEW_LIMIT })),
      );
      return settled.map((s, i) => ({
        board: boards[i]!,
        columns: s.status === 'fulfilled' ? s.value.columns : null,
      }));
    },
    [idsKey],
  );

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">Boards</h2>
        <LiveIndicator paused={paused} reconnecting={reconnecting} lastUpdated={lastUpdated} />
      </div>
      {loading ? (
        <Loading label="Loading boards…" />
      ) : error ? (
        <ErrorCard error={error} />
      ) : (
        <div className="space-y-8">
          {(data ?? []).map((entry) => (
            <BoardStrip key={entry.board.id} entry={entry} />
          ))}
        </div>
      )}
    </section>
  );
}

function BoardStrip({ entry }: { entry: WallEntry }) {
  const { board, columns } = entry;
  return (
    <div>
      <div className="mb-2 flex items-baseline gap-3">
        <Link
          to={`/boards/${encodeURIComponent(board.id)}`}
          className="text-base font-semibold tracking-tight text-neutral-900 hover:underline"
        >
          {board.name}
        </Link>
        {board.description ? (
          <span className="truncate text-sm text-neutral-500">{board.description}</span>
        ) : null}
      </div>
      {columns === null ? (
        <p className="text-sm text-red-600">Couldn’t load this board’s columns.</p>
      ) : columns.length === 0 ? (
        <p className="text-sm text-neutral-400">No active groups.</p>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {columns.map((col) => (
            <MiniColumn key={col.group_id} boardId={board.id} column={col} />
          ))}
        </div>
      )}
    </div>
  );
}

function MiniColumn({ boardId, column }: { boardId: string; column: BoardColumn }) {
  const overflow = column.total - column.tasks.length;
  return (
    <div className="w-56 shrink-0">
      <div className="mb-2 flex items-center gap-2 border-b border-neutral-200 pb-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-neutral-600">
          {column.group_name}
        </span>
        <Badge variant="secondary">{column.total}</Badge>
      </div>
      <div className="space-y-1.5">
        {column.tasks.length === 0 ? (
          <p className="py-1 text-xs text-neutral-400">No tasks</p>
        ) : (
          column.tasks.map((t) => (
            <Link
              key={t.id}
              to={`/tasks/${encodeURIComponent(t.id)}`}
              className="block truncate rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-xs text-neutral-800 shadow-sm hover:border-neutral-300"
            >
              {t.title}
            </Link>
          ))
        )}
        {overflow > 0 ? (
          <Link
            to={`/boards/${encodeURIComponent(boardId)}`}
            className="block px-1 py-0.5 text-xs font-medium text-neutral-500 hover:text-neutral-800 hover:underline"
          >
            +{overflow} more
          </Link>
        ) : null}
      </div>
    </div>
  );
}
