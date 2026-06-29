import { useState } from 'react';
import { Link } from 'react-router-dom';
import { getBoards } from '../lib/api.js';
import { useResource } from '../lib/useResource.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/Card.js';
import { Badge } from '../components/ui/Badge.js';
import { EmptyState, ErrorCard, Loading } from '../components/States.js';
import { formatDate } from '../lib/format.js';

export function Boards() {
  const [includeArchived, setIncludeArchived] = useState(false);
  const { data, error, loading } = useResource(
    () => getBoards(includeArchived ? {} : { archived: false }),
    [includeArchived],
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Boards</h1>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
          Show archived
        </label>
      </div>

      {loading ? (
        <Loading label="Loading boards…" />
      ) : error ? (
        <ErrorCard error={error} />
      ) : !data || data.results.length === 0 ? (
        <EmptyState title="No boards" hint="No boards match the current filter." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {data.results.map((b) => (
            <Link key={b.id} to={`/boards/${encodeURIComponent(b.id)}`} className="block">
              <Card className="h-full transition hover:border-input hover:shadow">
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <CardTitle>{b.name}</CardTitle>
                    {b.archived_at ? <Badge variant="muted">archived</Badge> : null}
                  </div>
                  {b.description ? (
                    <CardDescription className="line-clamp-2">{b.description}</CardDescription>
                  ) : null}
                </CardHeader>
                <CardContent className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="font-mono">{b.id}</span>
                  {b.archived_at ? <span>archived {formatDate(b.archived_at)}</span> : null}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
