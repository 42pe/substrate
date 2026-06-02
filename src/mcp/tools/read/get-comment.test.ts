import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from '@libsql/client';
import { openDatabaseAndMigrate } from '../../../storage/client.js';
import { createComment } from '../../../storage/repositories/comments.js';
import { getCommentToolHandler } from './get-comment.js';
import type { ToolDeps } from '../../deps.js';
import type { Comment, Config } from '../../../core/types.js';

const fixtureConfig: Config = {
  project_id: '00000000-0000-4000-8000-000000000001',
  project_name: 'TestProject',
  description: '',
  version: 1,
  schema_version: 2,
  created_at: '2026-05-09T00:00:00.000Z',
};

function makeComment(id: string): Comment {
  return {
    id,
    task_id: 'task-1',
    parent_id: null,
    body: 'hello',
    custom_data: {},
    created_by_agent: 'tester',
    created_at: '2026-05-09T00:00:00.000Z',
    edited_at: null,
    archived_at: null,
  };
}

describe('getCommentToolHandler', () => {
  let client: Client;
  let dir: string;
  let deps: ToolDeps;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'substrate-get-comment-'));
    client = await openDatabaseAndMigrate(join(dir, '.substrate', 'data.sqlite'));
    deps = {
      client,
      config: fixtureConfig,
      loadSubstrate: () => Promise.resolve({ config: fixtureConfig, boards: [] }),
      root: '/tmp/substrate-test',
    };
  });
  afterEach(async () => {
    client.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('returns the comment', async () => {
    await createComment(client, makeComment('c1'));
    const comment = await getCommentToolHandler({ id: 'c1' }, deps);
    expect(comment.id).toBe('c1');
    expect(comment.body).toBe('hello');
  });

  it('throws not_found for a missing comment', async () => {
    await expect(getCommentToolHandler({ id: 'nope' }, deps)).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});
