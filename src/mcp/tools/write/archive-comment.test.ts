import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from '@libsql/client';
import { openDatabaseAndMigrate } from '../../../storage/client.js';
import { createComment } from '../../../storage/repositories/comments.js';
import { listEvents } from '../../../storage/repositories/events.js';
import { archiveCommentHandler } from './archive-comment.js';
import type { ToolDeps } from '../../deps.js';
import type { Comment, Config, Substrate } from '../../../core/types.js';

const fixtureConfig: Config = {
  project_id: '00000000-0000-4000-8000-000000000001',
  project_name: 'TestProject',
  description: '',
  version: 1,
  schema_version: 2,
  created_at: '2026-05-09T00:00:00.000Z',
};

const substrate: Substrate = { config: fixtureConfig, boards: [] };

function makeComment(): Comment {
  return {
    id: 'c1',
    task_id: 't1',
    parent_id: null,
    body: 'body',
    custom_data: {},
    created_by_agent: 'tester',
    created_at: '2026-05-09T00:00:00.000Z',
    edited_at: null,
    archived_at: null,
  };
}

describe('archiveCommentHandler', () => {
  let client: Client;
  let dir: string;
  let deps: ToolDeps;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'substrate-archive-comment-'));
    client = await openDatabaseAndMigrate(join(dir, '.substrate', 'data.sqlite'));
    deps = {
      client,
      config: fixtureConfig,
      loadSubstrate: () => Promise.resolve(substrate),
      root: '/tmp/substrate-test',
    };
    await createComment(client, makeComment());
  });
  afterEach(async () => {
    client.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('archives a comment and emits comment_archived', async () => {
    const env = await archiveCommentHandler({ id: 'c1', agent_name: 'a' }, deps);
    if (!env.ok) throw new Error('expected success');
    expect(env.applied.state.archived_at).not.toBeNull();
    expect(env.applied.version).toBeNull();
    const { results } = await listEvents(client, 't1');
    expect(results.map((e) => e.event_type)).toEqual(['comment_archived']);
    expect(results[0]!.changes).toEqual({ comment_id: 'c1' });
  });

  it('re-archive is an idempotent no-op that emits no second event', async () => {
    await archiveCommentHandler({ id: 'c1', agent_name: 'a' }, deps);
    const env = await archiveCommentHandler({ id: 'c1', agent_name: 'a' }, deps);
    if (!env.ok) throw new Error('expected success');
    const { results } = await listEvents(client, 't1');
    expect(results).toHaveLength(1);
  });

  it('returns not_found for a missing comment', async () => {
    const env = await archiveCommentHandler({ id: 'ghost', agent_name: 'a' }, deps);
    if (env.ok) throw new Error('expected error');
    expect(env.error.code).toBe('not_found');
  });
});
