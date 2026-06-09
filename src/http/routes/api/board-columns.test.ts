import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
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
import type { Board, Config, Group, Task } from '../../../core/types.js';
import type { Client } from '@libsql/client';

const config: Config = {
  project_id: '11111111-1111-4111-8111-111111111111',
  project_name: 'Columns Proj',
  description: 'desc',
  version: 1,
  schema_version: 2,
  created_at: '2026-05-09T00:00:00.000Z',
};

function group(id: string, name: string, position: number, archived = false): Group {
  return {
    id,
    name,
    description: '',
    position,
    color: null,
    version: 1,
    archived_at: archived ? '2026-05-09T00:00:00.000Z' : null,
  };
}

function makeBoard(id: string, groups: Group[], archived = false): Board {
  return {
    id,
    name: `Board ${id}`,
    description: '',
    field_schema: { task: {}, comments: {} },
    groups,
    policies: [],
    version: 1,
    created_at: '2026-05-09T00:00:00.000Z',
    updated_at: '2026-05-09T00:00:00.000Z',
    archived_at: archived ? '2026-05-09T00:00:00.000Z' : null,
  };
}

function makeTask(
  id: string,
  boardId: string,
  groupId: string,
  updatedDay: string,
  archived = false,
): Task {
  return {
    id,
    board_id: boardId,
    group_id: groupId,
    parent_id: null,
    origin_task_id: null,
    title: `Task ${id}`,
    description: 'body',
    custom_data: {},
    version: 1,
    created_by_agent: 'tester',
    created_at: `2026-05-${updatedDay}T00:00:00.000Z`,
    updated_at: `2026-05-${updatedDay}T00:00:00.000Z`,
    archived_at: archived ? '2026-05-20T00:00:00.000Z' : null,
  };
}

interface ColumnsBody {
  board_id: string;
  columns: Array<{
    group_id: string;
    group_name: string;
    position: number;
    total: number;
    tasks: Array<{ id: string }>;
  }>;
}

describe('GET /api/boards/:id/columns', () => {
  let dir: string;
  let root: string;
  let client: Client;
  let app: Hono;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'substrate-cols-'));
    root = join(dir, '.substrate');
    await writeConfig(root, config);
    await mkdir(paths(root).boardsDir, { recursive: true });

    // b1: three active groups (out of position order on disk) + one archived group.
    await createBoardFile(
      root,
      makeBoard('b1', [
        group('g2', 'Doing', 1),
        group('g1', 'Todo', 0),
        group('g3', 'Done', 2),
        group('garch', 'Retired', 3, true),
      ]),
    );
    // barch: an archived board, still readable.
    await createBoardFile(root, makeBoard('barch', [group('only', 'Only', 0)], true));

    client = await openDatabaseAndMigrate(paths(root).dataSqlite);
    // g1: two active tasks (t1 older, t2 newer → expect [t2, t1]).
    await createTask(client, makeTask('t1', 'b1', 'g1', '01'));
    await createTask(client, makeTask('t2', 'b1', 'g1', '03'));
    // g2: one active + one archived (archived excluded from total + tasks).
    await createTask(client, makeTask('t3', 'b1', 'g2', '02'));
    await createTask(client, makeTask('t4', 'b1', 'g2', '04', true));
    // a task in the archived group, and one in an unknown group → both omitted.
    await createTask(client, makeTask('t5', 'b1', 'garch', '05'));
    await createTask(client, makeTask('t6', 'b1', 'ghost', '06'));
    // barch task.
    await createTask(client, makeTask('t7', 'barch', 'only', '07'));

    app = createApp({
      ...defaultHttpConfig(),
      apiDeps: { client, config, loadSubstrate: () => loadSubstrate(root) },
    });
  });
  afterEach(async () => {
    client.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('returns active groups as columns ordered by position; archived group omitted', async () => {
    const res = await app.request('/api/boards/b1/columns');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ColumnsBody;
    expect(body.board_id).toBe('b1');
    expect(body.columns.map((c) => c.group_id)).toEqual(['g1', 'g2', 'g3']);
    expect(body.columns.map((c) => c.position)).toEqual([0, 1, 2]);
  });

  it('counts only ACTIVE tasks; orders cards updated_at desc', async () => {
    const body = (await (await app.request('/api/boards/b1/columns')).json()) as ColumnsBody;
    const [g1, g2, g3] = body.columns;
    expect(g1!.total).toBe(2);
    expect(g1!.tasks.map((t) => t.id)).toEqual(['t2', 't1']); // newer first
    expect(g2!.total).toBe(1); // t4 archived → excluded
    expect(g2!.tasks.map((t) => t.id)).toEqual(['t3']);
    expect(g3!.total).toBe(0); // empty column
    expect(g3!.tasks).toEqual([]);
  });

  it('a task in an archived/unknown group never appears (group-list-driven)', async () => {
    const body = (await (await app.request('/api/boards/b1/columns')).json()) as ColumnsBody;
    const allIds = body.columns.flatMap((c) => c.tasks.map((t) => t.id));
    expect(allIds).not.toContain('t5'); // archived group
    expect(allIds).not.toContain('t6'); // unknown group
    expect(body.columns.some((c) => c.group_id === 'garch')).toBe(false);
  });

  it('limit caps tasks but NOT total', async () => {
    const body = (await (
      await app.request('/api/boards/b1/columns?limit=1')
    ).json()) as ColumnsBody;
    const g1 = body.columns.find((c) => c.group_id === 'g1')!;
    expect(g1.total).toBe(2);
    expect(g1.tasks.map((t) => t.id)).toEqual(['t2']); // newest only
  });

  it('a valid-but-huge limit is clamped, not rejected (unlike page_size)', async () => {
    const res = await app.request('/api/boards/b1/columns?limit=99999999');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ColumnsBody;
    expect(body.columns.find((c) => c.group_id === 'g1')!.tasks.length).toBe(2);
  });

  it('negative limit → 400', async () => {
    const res = await app.request('/api/boards/b1/columns?limit=-5');
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('schema_violation');
  });

  it('non-integer limit → 400', async () => {
    const res = await app.request('/api/boards/b1/columns?limit=abc');
    expect(res.status).toBe(400);
  });

  it('unknown board → 404', async () => {
    const res = await app.request('/api/boards/ghost/columns');
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('not_found');
  });

  it('an archived board is still served', async () => {
    const res = await app.request('/api/boards/barch/columns');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ColumnsBody;
    expect(body.columns.map((c) => c.group_id)).toEqual(['only']);
    expect(body.columns[0]!.total).toBe(1);
  });

  it('reads fresh: a board edit between calls is reflected', async () => {
    const before = (await (await app.request('/api/boards/b1/columns')).json()) as ColumnsBody;
    expect(before.columns.map((c) => c.group_id)).toEqual(['g1', 'g2', 'g3']);
    // Archive g3 on disk (overwrite the JSON — createBoardFile won't clobber).
    await writeFile(
      join(paths(root).boardsDir, 'b1.json'),
      JSON.stringify(
        makeBoard('b1', [
          group('g1', 'Todo', 0),
          group('g2', 'Doing', 1),
          group('g3', 'Done', 2, true),
          group('garch', 'Retired', 3, true),
        ]),
        null,
        2,
      ),
    );
    const after = (await (await app.request('/api/boards/b1/columns')).json()) as ColumnsBody;
    expect(after.columns.map((c) => c.group_id)).toEqual(['g1', 'g2']);
  });
});
