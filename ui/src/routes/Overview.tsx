import { Link } from 'react-router-dom';
import { getBoards, getProject } from '../lib/api.js';
import { useResource } from '../lib/useResource.js';
import { Markdown } from '../components/Markdown.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/Card.js';
import { Badge } from '../components/ui/Badge.js';
import { EmptyState, ErrorCard, Loading } from '../components/States.js';

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

      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-neutral-500">
          Boards
        </h2>
        {boards.loading ? (
          <Loading label="Loading boards…" />
        ) : boards.error ? (
          <ErrorCard error={boards.error} />
        ) : !boards.data || boards.data.results.length === 0 ? (
          <EmptyState
            title="No boards yet"
            hint="Create a board via the MCP tools to see it here."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {boards.data.results.map((b) => (
              <Link key={b.id} to={`/boards/${encodeURIComponent(b.id)}`} className="block">
                <Card className="h-full transition hover:border-neutral-300 hover:shadow">
                  <CardHeader>
                    <CardTitle>{b.name}</CardTitle>
                    {b.description ? (
                      <CardDescription className="line-clamp-2">{b.description}</CardDescription>
                    ) : null}
                  </CardHeader>
                  <CardContent>
                    <span className="font-mono text-xs text-neutral-400">{b.id}</span>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
