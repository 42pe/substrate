import type { Task, Comment, TaskEvent, Board, Group, Policy } from '@core/types';

/**
 * Typed read-only client over the Phase 5a HTTP API. Same-origin (the app is
 * served by `substrate serve`), so no base URL. GET only — the server exposes
 * no write routes. On a non-2xx the parsed `{ error }` body is thrown as an
 * `ApiError` so callers (via `useResource`) can render a typed error state.
 */

export interface ApiErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, body: ApiErrorBody | null) {
    super(body?.error.message ?? `HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = body?.error.code ?? 'internal_error';
  }
}

export interface Paginated<T> {
  results: T[];
  pagination: { next_cursor: string | null; has_more: boolean; page_size: number };
}

/** A column task plus any REQUIRED fields it is missing (Theme 4b). Mirrors the
 *  server `ColumnTask`. */
export interface ColumnTask extends Task {
  missing_required_fields: string[];
  /** B3/pending-approval: advancing this task is gated on an unset human_only field. */
  pending_approval: boolean;
  /** The human_only field(s) a human must set to unblock the move. */
  awaiting_fields: string[];
}

/** One kanban column: an active group + its true active-task count + a capped,
 *  `updated_at DESC` preview. Mirrors the server `BoardColumn` (Phase 9). */
export interface BoardColumn {
  group_id: string;
  group_name: string;
  position: number;
  color: string | null;
  total: number;
  tasks: ColumnTask[];
}

/** Lean task row from `list_tasks` / `GET /api/tasks` (default summary view).
 *  Mirrors the server `TaskSummary` (Phase 11). The List view reads only these
 *  fields; full detail comes from `getTask`. */
export interface TaskSummary {
  id: string;
  board_id: string;
  group_id: string;
  parent_id: string | null;
  origin_task_id: string | null;
  title: string;
  description_excerpt: string;
  description_truncated: boolean;
  custom_data: Record<string, unknown>;
  custom_data_omitted: string[];
  version: number;
  created_by_agent: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

/** A project-wide activity event (Theme 4a). Mirrors the server `ActivityEvent`. */
export interface ActivityEvent extends TaskEvent {
  task_title: string | null;
  board_id: string | null;
  board_name: string | null;
}

export interface BoardColumnsResult {
  board_id: string;
  columns: BoardColumn[];
}

export interface ProjectRecord {
  project_id: string;
  project_name: string;
  description: string;
  version: number;
  schema_version: number;
  created_at: string;
}

export interface BoardSummary {
  id: string;
  name: string;
  description: string;
  archived_at: string | null;
  version: number;
}

export interface BoardSubstrate {
  board: {
    id: string;
    name: string;
    description: string;
    version: number;
    created_at: string;
    updated_at: string;
    archived_at: string | null;
  };
  groups: Group[];
  field_schema: Board['field_schema'];
  policies: Policy[];
}

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    let body: ApiErrorBody | null = null;
    try {
      body = (await res.json()) as ApiErrorBody;
    } catch {
      // non-JSON error body; leave body null
    }
    throw new ApiError(res.status, body);
  }
  return (await res.json()) as T;
}

export const getProject = (): Promise<ProjectRecord> => apiGet('/project');

export const getBoards = (params: { archived?: boolean } = {}): Promise<Paginated<BoardSummary>> =>
  apiGet(`/boards${qs(params)}`);

export const getBoard = (id: string): Promise<BoardSubstrate> =>
  apiGet(`/boards/${encodeURIComponent(id)}`);

export const getBoardColumns = (
  id: string,
  params: { limit?: number } = {},
): Promise<BoardColumnsResult> => apiGet(`/boards/${encodeURIComponent(id)}/columns${qs(params)}`);

// The inspector only ever lists summaries — no `view` param, so the full-row
// branch is unreachable from the browser (the invariant lives in the type).
export const getTasks = (
  params: {
    board_id?: string;
    in_groups?: string;
    archived?: boolean;
    text_search?: string;
    cursor?: string;
    page_size?: number;
    sort?: string;
    direction?: string;
  } = {},
): Promise<Paginated<TaskSummary>> => apiGet(`/tasks${qs(params)}`);

export const getTask = (id: string): Promise<Task> => apiGet(`/tasks/${encodeURIComponent(id)}`);

/** Per-task pending-approval flag (sprint pending-approval). Mirrors the server
 *  `PendingApproval`. */
export interface TaskApproval {
  pending: boolean;
  gate?: { policy_id: string; policy_name: string; to_group: string };
  awaiting_fields: string[];
}

export const getTaskApproval = (id: string): Promise<TaskApproval> =>
  apiGet(`/tasks/${encodeURIComponent(id)}/approval`);

export const getTaskHistory = (
  id: string,
  params: { cursor?: string; page_size?: number } = {},
): Promise<Paginated<TaskEvent>> => apiGet(`/tasks/${encodeURIComponent(id)}/history${qs(params)}`);

export const getComments = (
  id: string,
  params: { parent_id?: string; cursor?: string; page_size?: number } = {},
): Promise<Paginated<Comment>> => apiGet(`/tasks/${encodeURIComponent(id)}/comments${qs(params)}`);

export const getActivity = (
  params: { cursor?: string; page_size?: number } = {},
): Promise<Paginated<ActivityEvent>> => apiGet(`/activity${qs(params)}`);
