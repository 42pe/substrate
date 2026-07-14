import { useMatch } from 'react-router-dom';
import { getBoard, getTask } from './api.js';
import { useResource } from './useResource.js';

/**
 * The board a route is "about", resolved for the persistent app header
 * (`AppHeader`). A board route (`/boards/:id`) names the board directly; a task
 * route (`/tasks/:id`) names it indirectly via the task's `board_id` (the
 * acknowledged extra fetch). Every other route has no active board.
 *
 * `useMatch` is used (not `useParams`) so this resolves correctly from the
 * layout ancestor, where the route params don't bubble. The board name is
 * static per id and not polled, so a plain `useResource` keyed on the route id
 * is the right fetch — it re-runs on navigation (no stale name) and, on a load
 * error or 404, degrades to `null` rather than surfacing an error in the chrome.
 */
export interface ActiveBoard {
  id: string | null;
  name: string | null;
  loading: boolean;
}

export function useActiveBoard(): ActiveBoard {
  const boardId = useMatch('/boards/:id')?.params.id ?? null;
  const taskId = useMatch('/tasks/:id')?.params.id ?? null;

  const { data, loading } = useResource<{ id: string; name: string } | null>(async () => {
    if (boardId) {
      const { board } = await getBoard(boardId);
      return { id: board.id, name: board.name };
    }
    if (taskId) {
      const task = await getTask(taskId);
      const { board } = await getBoard(task.board_id);
      return { id: board.id, name: board.name };
    }
    return null;
  }, [boardId, taskId]);

  return { id: data?.id ?? null, name: data?.name ?? null, loading };
}
