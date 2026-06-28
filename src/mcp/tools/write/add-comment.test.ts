import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmrf } from '../../../../tests/helpers/tmp.js';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from '@libsql/client';
import { openDatabaseAndMigrate } from '../../../storage/client.js';
import { createTask, archiveTask } from '../../../storage/repositories/tasks.js';
import { archiveComment } from '../../../storage/repositories/comments.js';
import { listEvents } from '../../../storage/repositories/events.js';
import { addCommentHandler } from './add-comment.js';
import type { ToolDeps } from '../../deps.js';
import type { Board, Config, Substrate, Task } from '../../../core/types.js';

const fixtureConfig: Config = {
  project_id: '00000000-0000-4000-8000-000000000001',
  project_name: 'TestProject',
  description: '',
  version: 1,
  schema_version: 2,
  created_at: '2026-05-09T00:00:00.000Z',
};

const board: Board = {
  id: 'board-1',
  name: 'Board 1',
  description: '',
  field_schema: {
    task: {},
    comments: { kind: { type: 'enum', values: ['note', 'review'] } },
  },
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

const substrate: Substrate = { config: fixtureConfig, boards: [board] };

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    board_id: 'board-1',
    group_id: 'g1',
    parent_id: null,
    origin_task_id: null,
    title: 'T',
    description: '',
    custom_data: {},
    version: 1,
    created_by_agent: 'tester',
    created_at: '2026-05-09T00:00:00.000Z',
    updated_at: '2026-05-09T00:00:00.000Z',
    archived_at: null,
    ...overrides,
  };
}

describe('addCommentHandler', () => {
  let client: Client;
  let dir: string;
  let deps: ToolDeps;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'substrate-add-comment-'));
    client = await openDatabaseAndMigrate(join(dir, '.substrate', 'data.sqlite'));
    deps = {
      client,
      config: fixtureConfig,
      loadSubstrate: () => Promise.resolve(substrate),
      root: '/tmp/substrate-test',
    };
    await createTask(client, makeTask());
  });
  afterEach(async () => {
    client.close();
    await rmrf(dir);
  });

  it('adds a comment and emits comment_added (version null)', async () => {
    const env = await addCommentHandler({ task_id: 't1', body: 'hi', agent_name: 'a' }, deps);
    if (!env.ok) throw new Error('expected success');
    expect(env.applied.entity).toBe('comment');
    expect(env.applied.version).toBeNull();
    expect(env.applied.state.body).toBe('hi');
    const { results } = await listEvents(client, 't1');
    expect(results.map((e) => e.event_type)).toEqual(['comment_added']);
    expect(results[0]!.changes).toEqual({ comment_id: env.applied.id });
  });

  it('allows a reply whose parent is on the same task', async () => {
    const root = await addCommentHandler({ task_id: 't1', body: 'root', agent_name: 'a' }, deps);
    if (!root.ok) throw new Error('expected success');
    const reply = await addCommentHandler(
      { task_id: 't1', parent_id: root.applied.id, body: 'reply', agent_name: 'a' },
      deps,
    );
    if (!reply.ok) throw new Error('expected success');
    expect(reply.applied.state.parent_id).toBe(root.applied.id);
  });

  it('validates custom_data against field_schema.comments', async () => {
    const env = await addCommentHandler(
      { task_id: 't1', body: 'x', custom_data: { kind: 'bogus' }, agent_name: 'a' },
      deps,
    );
    if (env.ok) throw new Error('expected error');
    expect(env.error.code).toBe('schema_violation');
  });

  it('rejects a comment on a missing task with not_found', async () => {
    const env = await addCommentHandler({ task_id: 'nope', body: 'x', agent_name: 'a' }, deps);
    if (env.ok) throw new Error('expected error');
    expect(env.error.code).toBe('not_found');
  });

  it('rejects a comment on an archived task with conflict', async () => {
    await archiveTask(client, 't1', 1, '2026-05-10T00:00:00.000Z');
    const env = await addCommentHandler({ task_id: 't1', body: 'x', agent_name: 'a' }, deps);
    if (env.ok) throw new Error('expected error');
    expect(env.error.code).toBe('conflict');
  });

  it('rejects a reply whose parent belongs to a different task (conflict)', async () => {
    await createTask(client, makeTask({ id: 't2' }));
    const otherTaskComment = await addCommentHandler(
      { task_id: 't2', body: 'elsewhere', agent_name: 'a' },
      deps,
    );
    if (!otherTaskComment.ok) throw new Error('expected success');
    const env = await addCommentHandler(
      { task_id: 't1', parent_id: otherTaskComment.applied.id, body: 'x', agent_name: 'a' },
      deps,
    );
    if (env.ok) throw new Error('expected error');
    expect(env.error.code).toBe('conflict');
  });

  it('rejects a reply to an archived parent (conflict)', async () => {
    const root = await addCommentHandler({ task_id: 't1', body: 'root', agent_name: 'a' }, deps);
    if (!root.ok) throw new Error('expected success');
    await archiveComment(client, root.applied.id, '2026-05-10T00:00:00.000Z');
    const env = await addCommentHandler(
      { task_id: 't1', parent_id: root.applied.id, body: 'x', agent_name: 'a' },
      deps,
    );
    if (env.ok) throw new Error('expected error');
    expect(env.error.code).toBe('conflict');
  });

  it('rejects a reply to a missing parent (not_found)', async () => {
    const env = await addCommentHandler(
      { task_id: 't1', parent_id: 'ghost', body: 'x', agent_name: 'a' },
      deps,
    );
    if (env.ok) throw new Error('expected error');
    expect(env.error.code).toBe('not_found');
  });
});
