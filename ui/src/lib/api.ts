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
): Promise<Paginated<Task>> => apiGet(`/tasks${qs(params)}`);

export const getTask = (id: string): Promise<Task> => apiGet(`/tasks/${encodeURIComponent(id)}`);

export const getTaskHistory = (
  id: string,
  params: { cursor?: string; page_size?: number } = {},
): Promise<Paginated<TaskEvent>> => apiGet(`/tasks/${encodeURIComponent(id)}/history${qs(params)}`);

export const getComments = (
  id: string,
  params: { parent_id?: string; cursor?: string; page_size?: number } = {},
): Promise<Paginated<Comment>> => apiGet(`/tasks/${encodeURIComponent(id)}/comments${qs(params)}`);

export const getComment = (id: string): Promise<Comment> =>
  apiGet(`/comments/${encodeURIComponent(id)}`);
