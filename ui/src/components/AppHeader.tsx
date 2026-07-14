import { Link } from 'react-router-dom';
import { getProject } from '../lib/api.js';
import { useResource } from '../lib/useResource.js';
import { useActiveBoard } from '../lib/useActiveBoard.js';

/**
 * The persistent identity block in the app header (`Shell`): the project name
 * (always, once resolved — links to Overview) and, on a board or task route,
 * the active board's human name (links to that board). Read-only and
 * side-effect-free: it reuses the existing `getProject` / `getBoard` /
 * `getTask` GETs via `useResource`, adds no endpoint, and never renders an
 * error card — a still-loading or failed segment simply renders nothing, so the
 * chrome stays quiet and doesn't crowd the page-body live indicator.
 *
 * Segments truncate on narrow widths; the whole block sits on one line next to
 * the wordmark and wraps as a unit if the row runs out of room.
 */
function Separator() {
  return (
    <span aria-hidden className="text-muted-foreground/60">
      ·
    </span>
  );
}

export function AppHeader() {
  const projectName = useResource(() => getProject(), []).data?.project_name ?? null;
  const board = useActiveBoard();

  return (
    <div className="flex min-w-0 items-center gap-2 text-sm">
      {projectName ? (
        <>
          <Separator />
          <Link
            to="/"
            title={projectName}
            className="max-w-[9rem] truncate font-medium text-foreground transition hover:text-foreground/80 sm:max-w-[14rem]"
          >
            {projectName}
          </Link>
        </>
      ) : null}
      {board.id && board.name ? (
        <>
          <Separator />
          <Link
            to={`/boards/${board.id}`}
            title={board.name}
            className="max-w-[9rem] truncate text-muted-foreground transition hover:text-foreground sm:max-w-[14rem]"
          >
            {board.name}
          </Link>
        </>
      ) : null}
    </div>
  );
}
