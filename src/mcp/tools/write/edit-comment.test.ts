import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from '@libsql/client';
import { openDatabaseAndMigrate } from '../../../storage/client.js';
import { createTask } from '../../../storage/repositories/tasks.js';
import { createComment } from '../../../storage/repositories/comments.js';
import { listEvents } from '../../../storage/repositories/events.js';
import { editCommentHandler } from './edit-comment.js';
import type { ToolDeps } from '../../deps.js';
import type { Board, Comment, Config, Substrate, Task } from '../../../core/types.js';

const fixtureConfig: Config = {
  project_id: '00000000-0000-4000-8000-000000000001',
  project_name: 'TestProject',
  schema_version: 2,
  created_at: '2026-05-09T00:00:00.000Z',
};

const board: Board = {
  id: 'board-1',
  name: 'Board 1',
  description: '',
  field_schema: { task: {}, comments: { kind: { type: 'enum', values: ['note'] } } },
  groups: [],
  policies: [],
  version: 1,
  created_at: '2026-05-09T00:00:00.000Z',
  updated_at: '2026-05-09T00:00:00.000Z',
  archived_at: null,
};

const substrate: Substrate = { config: fixtureConfig, boards: [board] };

function makeTask(): Task {
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
  };
}

function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 'c1',
    task_id: 't1',
    parent_id: null,
    body: 'original body',
    custom_data: {},
    created_by_agent: 'tester',
    created_at: '2026-05-09T00:00:00.000Z',
    edited_at: null,
    archived_at: null,
    ...overrides,
  };
}

describe('editCommentHandler', () => {
  let client: Client;
  let dir: string;
  let deps: ToolDeps;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'substrate-edit-comment-'));
    client = await openDatabaseAndMigrate(join(dir, '.substrate', 'data.sqlite'));
    deps = { client, config: fixtureConfig, loadSubstrate: () => Promise.resolve(substrate) };
    await createTask(client, makeTask());
    await createComment(client, makeComment());
  });
  afterEach(async () => {
    client.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('edits the body, sets edited_at, and emits comment_edited with prior body', async () => {
    const env = await editCommentHandler({ id: 'c1', body: 'new body', agent_name: 'a' }, deps);
    if (!env.ok) throw new Error('expected success');
    expect(env.applied.state.body).toBe('new body');
    expect(env.applied.state.edited_at).not.toBeNull();

    const { results } = await listEvents(client, 't1');
    expect(results.map((e) => e.event_type)).toEqual(['comment_edited']);
    expect(results[0]!.changes).toEqual({
      comment_id: 'c1',
      before: { body: 'original body' },
      after: { body: 'new body' },
    });
  });

  it('merges custom_data and validates against field_schema.comments', async () => {
    const env = await editCommentHandler(
      { id: 'c1', custom_data: { kind: 'note' }, agent_name: 'a' },
      deps,
    );
    if (!env.ok) throw new Error('expected success');
    expect(env.applied.state.custom_data).toEqual({ kind: 'note' });
  });

  it('rejects custom_data violating field_schema.comments', async () => {
    const env = await editCommentHandler(
      { id: 'c1', custom_data: { kind: 'bogus' }, agent_name: 'a' },
      deps,
    );
    if (env.ok) throw new Error('expected error');
    expect(env.error.code).toBe('schema_violation');
  });

  it('returns not_found for a missing comment', async () => {
    const env = await editCommentHandler({ id: 'ghost', body: 'x', agent_name: 'a' }, deps);
    if (env.ok) throw new Error('expected error');
    expect(env.error.code).toBe('not_found');
  });
});
