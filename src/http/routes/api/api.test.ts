import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hono } from 'hono';
import { createApp, defaultHttpConfig } from '../../server.js';
import { writeConfig } from '../../../shared/config.js';
import { paths } from '../../../shared/paths.js';
import { createBoardFile } from '../../../substrate/writer.js';
import { loadSubstrate } from '../../../substrate/loader.js';
import { openDatabaseAndMigrate } from '../../../storage/client.js';
import { createTask } from '../../../storage/repositories/tasks.js';
import { createComment } from '../../../storage/repositories/comments.js';
import { appendEvent } from '../../../storage/repositories/events.js';
import type { Board, Config, Task, Comment } from '../../../core/types.js';
import type { Client } from '@libsql/client';

const config: Config = {
  project_id: '11111111-1111-4111-8111-111111111111',
  project_name: 'API Proj',
  description: 'desc',
  version: 1,
  schema_version: 2,
  created_at: '2026-05-09T00:00:00.000Z',
};

const board: Board = {
  id: 'b1',
  name: 'Board 1',
  description: '',
  field_schema: { task: {}, comments: {} },
  groups: [
    {
      id: 'g1',
      name: 'Todo',
      description: '',
      position: 0,
      color: null,
      version: 1,
      archived_at: null,
    },
  ],
  policies: [],
  version: 1,
  created_at: '2026-05-09T00:00:00.000Z',
  updated_at: '2026-05-09T00:00:00.000Z',
  archived_at: null,
};

function makeTask(id: string): Task {
  return {
    id,
    board_id: 'b1',
    group_id: 'g1',
    parent_id: null,
    origin_task_id: null,
    title: `Task ${id}`,
    description: 'body',
    custom_data: {},
    version: 1,
    created_by_agent: 'tester',
    created_at: `2026-05-0${id}T00:00:00.000Z`,
    updated_at: `2026-05-0${id}T00:00:00.000Z`,
    archived_at: null,
  };
}

function makeComment(id: string, taskId: string): Comment {
  return {
    id,
    task_id: taskId,
    parent_id: null,
    body: 'a comment',
    custom_data: {},
    created_by_agent: 'tester',
    created_at: '2026-05-09T00:00:00.000Z',
    edited_at: null,
    archived_at: null,
  };
}

describe('HTTP read API', () => {
  let dir: string;
  let root: string;
  let client: Client;
  let app: Hono;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'substrate-api-'));
    root = join(dir, '.substrate');
    await writeConfig(root, config);
    await mkdir(paths(root).boardsDir, { recursive: true });
    await createBoardFile(root, board);
    client = await openDatabaseAndMigrate(paths(root).dataSqlite);
    await createTask(client, makeTask('1'));
    await createTask(client, makeTask('2'));
    await createComment(client, makeComment('c1', '1'));
    await appendEvent(client, {
      task_id: '1',
      event_type: 'created',
      changes: {},
      actor_agent_name: 'tester',
      occurred_at: '2026-05-09T00:00:00.000Z',
    });
    app = createApp({
      ...defaultHttpConfig(),
      apiDeps: { client, config, loadSubstrate: () => loadSubstrate(root) },
    });
  });
  afterEach(async () => {
    client.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('GET /api/project returns the project record', async () => {
    const res = await app.request('/api/project');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { project_id: string; description: string; version: number };
    expect(body.project_id).toBe(config.project_id);
    expect(body.description).toBe('desc');
    expect(body.version).toBe(1);
  });

  it('GET /api/boards returns board summaries', async () => {
    const res = await app.request('/api/boards');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: Array<{ id: string }> };
    expect(body.results.map((b) => b.id)).toEqual(['b1']);
  });

  it('GET /api/boards/:id returns the board substrate', async () => {
    const res = await app.request('/api/boards/b1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { board: { id: string }; groups: Array<{ id: string }> };
    expect(body.board.id).toBe('b1');
    expect(body.groups.map((g) => g.id)).toEqual(['g1']);
  });

  it('GET /api/boards/:id unknown → 404', async () => {
    const res = await app.request('/api/boards/ghost');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('not_found');
  });

  it('GET /api/tasks lists tasks; board_id filter works', async () => {
    const res = await app.request('/api/tasks?board_id=b1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: Array<{ id: string }> };
    expect(body.results.map((t) => t.id).sort()).toEqual(['1', '2']);
  });

  it('GET /api/tasks paginates via cursor', async () => {
    const p1 = (await (
      await app.request('/api/tasks?sort=created_at&direction=asc&page_size=1')
    ).json()) as { results: Array<{ id: string }>; pagination: { next_cursor: string | null } };
    expect(p1.results.map((t) => t.id)).toEqual(['1']);
    const cursor = encodeURIComponent(p1.pagination.next_cursor!);
    const p2 = (await (
      await app.request(`/api/tasks?sort=created_at&direction=asc&page_size=1&cursor=${cursor}`)
    ).json()) as { results: Array<{ id: string }> };
    expect(p2.results.map((t) => t.id)).toEqual(['2']);
  });

  it('GET /api/tasks/:id returns a task; unknown → 404', async () => {
    expect((await app.request('/api/tasks/1')).status).toBe(200);
    const res = await app.request('/api/tasks/nope');
    expect(res.status).toBe(404);
  });

  it('GET /api/tasks/:id/history returns events; unknown task → empty 200 (not 404)', async () => {
    const known = (await (await app.request('/api/tasks/1/history')).json()) as {
      results: Array<{ event_type: string }>;
    };
    expect(known.results.map((e) => e.event_type)).toEqual(['created']);
    const unknown = await app.request('/api/tasks/ghost/history');
    expect(unknown.status).toBe(200);
    expect(((await unknown.json()) as { results: unknown[] }).results).toEqual([]);
  });

  it('GET /api/tasks/:id/comments returns comments; unknown task → empty 200', async () => {
    const known = (await (await app.request('/api/tasks/1/comments')).json()) as {
      results: Array<{ id: string }>;
    };
    expect(known.results.map((c) => c.id)).toEqual(['c1']);
    const unknown = await app.request('/api/tasks/ghost/comments');
    expect(unknown.status).toBe(200);
  });

  it('GET /api/comments/:id returns a comment; unknown → 404', async () => {
    expect((await app.request('/api/comments/c1')).status).toBe(200);
    expect((await app.request('/api/comments/ghost')).status).toBe(404);
  });

  it('missing_required_fields without board_id → 400', async () => {
    const res = await app.request('/api/tasks?missing_required_fields=true');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('schema_violation');
  });

  it('page_size over the max → 400 (schema rejects, does not clamp)', async () => {
    const res = await app.request('/api/boards?page_size=9999');
    expect(res.status).toBe(400);
  });

  it('page_size non-integer → 400', async () => {
    const res = await app.request('/api/boards?page_size=abc');
    expect(res.status).toBe(400);
  });

  it('a bad boolean query → 400', async () => {
    const res = await app.request('/api/boards?archived=maybe');
    expect(res.status).toBe(400);
  });

  it('cross-origin request → 403', async () => {
    const res = await app.request('/api/boards', { headers: { Origin: 'https://evil.com' } });
    expect(res.status).toBe(403);
  });

  it('a write verb under /api is not routable → 404', async () => {
    const res = await app.request('/api/boards', { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('GET /api/activity returns cross-board events enriched with task title + board name', async () => {
    // Add a move_blocked on task 2 so the feed spans more than one event/type.
    await appendEvent(client, {
      task_id: '2',
      event_type: 'move_blocked',
      changes: { policy_id: 'guard-x', from_group: 'g1', to_group: 'done', message: 'nope' },
      actor_agent_name: 'agent-z',
      occurred_at: '2026-05-10T00:00:00.000Z',
    });
    const res = await app.request('/api/activity');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: Array<{
        event_type: string;
        task_id: string;
        task_title: string | null;
        board_id: string | null;
        board_name: string | null;
        actor_agent_name: string;
      }>;
      pagination: { has_more: boolean };
    };
    // Newest first: the move_blocked (2026-05-10) precedes the created (2026-05-09).
    expect(body.results[0]!.event_type).toBe('move_blocked');
    expect(body.results[0]!.task_title).toBe('Task 2');
    expect(body.results[0]!.board_id).toBe('b1');
    expect(body.results[0]!.board_name).toBe('Board 1');
    expect(body.results.some((e) => e.event_type === 'created')).toBe(true);
  });

  it('/api/project returns JSON, not the SPA HTML (route ordering)', async () => {
    const res = await app.request('/api/project');
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
  });

  it('a client deep-link (/boards/x) falls through to the SPA index.html', async () => {
    const res = await app.request('/boards/x');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
  });

  it('an UNKNOWN /api/* path returns 404, NOT the SPA HTML (catch-all excludes /api)', async () => {
    const res = await app.request('/api/nope');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type') ?? '').not.toMatch(/text\/html/);
  });
});
