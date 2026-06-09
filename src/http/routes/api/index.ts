import type { Hono } from 'hono';
import type { ToolDeps } from '../../../mcp/deps.js';
import { getProjectHandler } from '../../../mcp/tools/read/get-project.js';
import { listBoardsHandler, listBoardsShape } from '../../../mcp/tools/read/list-boards.js';
import {
  getBoardSubstrateHandler,
  getBoardSubstrateShape,
} from '../../../mcp/tools/read/get-board-substrate.js';
import { listTasksToolHandler, listTasksShape } from '../../../mcp/tools/read/list-tasks.js';
import { getTaskToolHandler, getTaskShape } from '../../../mcp/tools/read/get-task.js';
import {
  getTaskHistoryHandler,
  getTaskHistoryShape,
} from '../../../mcp/tools/read/get-task-history.js';
import {
  listCommentsToolHandler,
  listCommentsShape,
} from '../../../mcp/tools/read/list-comments.js';
import { getCommentToolHandler, getCommentShape } from '../../../mcp/tools/read/get-comment.js';
import { getBoardColumnsHandler, boardColumnsShape } from './board-columns.js';
import {
  boolParam,
  intParam,
  listParam,
  strParam,
  parentIdParam,
  paginationParam,
  validateInput,
} from './query.js';

/**
 * The read-only HTTP JSON API (Phase 5a). Eight `GET /api/...` endpoints
 * mirroring the MCP read tools, REUSING the same handlers (single source of
 * truth). Reads only — NO write route is ever registered, so the API cannot
 * mutate state regardless of method. Thrown `SubstrateError`s propagate to the
 * app's `onError` handler, which maps them to the right HTTP status.
 *
 * `apiDeps` is `Pick<ToolDeps, 'client'|'config'|'loadSubstrate'>` — no `root`,
 * so the HTTP surface structurally cannot reach the substrate-write root. The
 * read handlers are typed on `ToolDeps` but never reference `root`, so the cast
 * below is sound.
 */
export type ApiDeps = Pick<ToolDeps, 'client' | 'config' | 'loadSubstrate'>;

export function registerApiRoutes(app: Hono, deps: ApiDeps): void {
  const td = deps as unknown as ToolDeps;

  app.get('/api/project', (c) => c.json(getProjectHandler(td)));

  app.get('/api/boards', async (c) => {
    const input = validateInput(listBoardsShape, {
      archived: boolParam(c.req.query('archived'), 'archived'),
      pagination: paginationParam(c),
    });
    return c.json(await listBoardsHandler(input, td));
  });

  app.get('/api/boards/:id', async (c) => {
    const input = validateInput(getBoardSubstrateShape, { board_id: c.req.param('id') });
    return c.json(await getBoardSubstrateHandler(input, td));
  });

  // Kanban columns aggregate (Phase 9). HTTP-only — no MCP twin (like /api/health).
  // `intParam` 400s a non-integer `limit`; the Zod shape then rejects <=0 and
  // clamps a too-large value to KANBAN_COLUMN_LIMIT.
  app.get('/api/boards/:id/columns', async (c) => {
    const input = validateInput(boardColumnsShape, {
      board_id: c.req.param('id'),
      limit: intParam(c.req.query('limit'), 'limit'),
    });
    return c.json(await getBoardColumnsHandler(input, td));
  });

  app.get('/api/tasks', async (c) => {
    const q = c.req.query.bind(c.req);
    const input = validateInput(listTasksShape, {
      filters: {
        board_id: strParam(q('board_id')),
        in_groups: listParam(q('in_groups')),
        not_in_groups: listParam(q('not_in_groups')),
        parent_id: parentIdParam(q('parent_id')),
        has_subtasks: boolParam(q('has_subtasks'), 'has_subtasks'),
        archived: boolParam(q('archived'), 'archived'),
        created_before: strParam(q('created_before')),
        created_after: strParam(q('created_after')),
        updated_before: strParam(q('updated_before')),
        updated_after: strParam(q('updated_after')),
        missing_required_fields: boolParam(q('missing_required_fields'), 'missing_required_fields'),
        text_search: strParam(q('text_search')),
      },
      sort:
        q('sort') !== undefined
          ? { field: q('sort'), direction: q('direction') ?? 'desc' }
          : undefined,
      pagination: paginationParam(c),
    });
    return c.json(await listTasksToolHandler(input, td));
  });

  app.get('/api/tasks/:id', async (c) => {
    const input = validateInput(getTaskShape, { id: c.req.param('id') });
    return c.json(await getTaskToolHandler(input, td));
  });

  app.get('/api/tasks/:id/history', async (c) => {
    const input = validateInput(getTaskHistoryShape, {
      task_id: c.req.param('id'),
      filters: {
        event_types: listParam(c.req.query('event_types')),
        since: strParam(c.req.query('since')),
        until: strParam(c.req.query('until')),
      },
      pagination: paginationParam(c),
    });
    return c.json(await getTaskHistoryHandler(input, td));
  });

  app.get('/api/tasks/:id/comments', async (c) => {
    const input = validateInput(listCommentsShape, {
      task_id: c.req.param('id'),
      filters: {
        parent_id: parentIdParam(c.req.query('parent_id')),
        since: strParam(c.req.query('since')),
        until: strParam(c.req.query('until')),
      },
      pagination: paginationParam(c),
    });
    return c.json(await listCommentsToolHandler(input, td));
  });

  app.get('/api/comments/:id', async (c) => {
    const input = validateInput(getCommentShape, { id: c.req.param('id') });
    return c.json(await getCommentToolHandler(input, td));
  });
}
