import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from '@libsql/client';
import { openDatabaseAndMigrate } from '../../../storage/client.js';
import { createComment } from '../../../storage/repositories/comments.js';
import { listCommentsToolHandler } from './list-comments.js';
import type { ToolDeps } from '../../deps.js';
import type { Comment, Config } from '../../../core/types.js';

const fixtureConfig: Config = {
  project_id: '00000000-0000-4000-8000-000000000001',
  project_name: 'TestProject',
  schema_version: 2,
  created_at: '2026-05-09T00:00:00.000Z',
};

function makeComment(overrides: Partial<Comment>): Comment {
  return {
    id: 'c1',
    task_id: 'task-1',
    parent_id: null,
    body: 'hello',
    custom_data: {},
    created_by_agent: 'tester',
    created_at: '2026-05-09T00:00:00.000Z',
    edited_at: null,
    archived_at: null,
    ...overrides,
  };
}

describe('listCommentsToolHandler', () => {
  let client: Client;
  let dir: string;
  let deps: ToolDeps;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'substrate-list-comments-'));
    client = await openDatabaseAndMigrate(join(dir, '.substrate', 'data.sqlite'));
    deps = {
      client,
      config: fixtureConfig,
      loadSubstrate: () => Promise.resolve({ config: fixtureConfig, boards: [] }),
    };
  });
  afterEach(async () => {
    client.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('lists a task comments oldest-first', async () => {
    await createComment(client, makeComment({ id: 'c1', created_at: '2026-05-01T00:00:00Z' }));
    await createComment(client, makeComment({ id: 'c2', created_at: '2026-05-02T00:00:00Z' }));
    const r = await listCommentsToolHandler({ task_id: 'task-1' }, deps);
    expect(r.results.map((c) => c.id)).toEqual(['c1', 'c2']);
  });

  it('filters thread roots with parent_id: null', async () => {
    await createComment(client, makeComment({ id: 'c1', created_at: '2026-05-01T00:00:00Z' }));
    await createComment(
      client,
      makeComment({ id: 'c2', parent_id: 'c1', created_at: '2026-05-02T00:00:00Z' }),
    );
    const r = await listCommentsToolHandler(
      { task_id: 'task-1', filters: { parent_id: null } },
      deps,
    );
    expect(r.results.map((c) => c.id)).toEqual(['c1']);
  });
});
