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
import { getActivityHandler, activityShape } from './activity.js';
import { listPendingApprovals } from '../../../operations/list-pending-approvals.js';
import { pendingApprovalFor } from '../../../policy/pending-approval.js';
import { getTask } from '../../../storage/repositories/tasks.js';
import { SubstrateError } from '../../../core/errors.js';
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
      // top-level (sibling to sort/pagination), NOT under filters — else the
      // Zod default always wins. `?view=full` opts into full rows.
      view: strParam(q('view')),
    });
    return c.json(await listTasksToolHandler(input, td));
  });

  app.get('/api/tasks/:id', async (c) => {
    const input = validateInput(getTaskShape, { id: c.req.param('id') });
    return c.json(await getTaskToolHandler(input, td));
  });

  // Per-task pending-approval flag for the task-detail pill (sprint pending-approval).
  // HTTP-only — keeps the MCP `get_task` output shape stable for agents.
  app.get('/api/tasks/:id/approval', async (c) => {
    const task = await getTask(td.client, c.req.param('id')); // not_found → 404
    const substrate = await td.loadSubstrate();
    const board = substrate.boards.find((b) => b.id === task.board_id);
    if (!board) {
      throw SubstrateError.notFound(
        `Board '${task.board_id}' for task '${task.id}' not found in substrate.`,
        { entity: 'board', id: task.board_id },
      );
    }
    return c.json(pendingApprovalFor(board, task));
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

  // Project-wide activity feed (Theme 4a). HTTP-only — no MCP twin (agents read
  // per-task history via get_task_history).
  app.get('/api/activity', async (c) => {
    const input = validateInput(activityShape, { pagination: paginationParam(c) });
    return c.json(await getActivityHandler(input, td));
  });

  // Cross-board "pending human approval" list (sprint pending-approval). Backs a
  // UI roll-up; the per-task pill rides on /api/boards/:id/columns. An optional
  // ?board_id scopes it; the MCP `list_pending_approvals` tool is the agent twin.
  app.get('/api/pending-approvals', async (c) => {
    return c.json(await listPendingApprovals(td, strParam(c.req.query('board_id'))));
  });
}
