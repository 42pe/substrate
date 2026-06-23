import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from '@libsql/client';
import { openDatabaseAndMigrate } from '../client.js';
import {
  createComment,
  getComment,
  editComment,
  archiveComment,
  listComments,
} from './comments.js';
import type { Comment } from '../../core/types.js';

function makeComment(overrides: Partial<Comment> = {}): Comment {
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

const NOW = '2026-05-10T00:00:00.000Z';

describe('comments repository', () => {
  let client: Client;
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'substrate-comments-'));
    client = await openDatabaseAndMigrate(join(dir, '.substrate', 'data.sqlite'));
  });
  afterEach(async () => {
    client.close();
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it('createComment + getComment round-trips', async () => {
    const c = makeComment({ custom_data: { pr_url: 'https://x' } });
    await createComment(client, c);
    expect(await getComment(client, 'c1')).toEqual(c);
  });

  it('getComment throws not_found for missing', async () => {
    await expect(getComment(client, 'nope')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('editComment is last-write-wins and sets edited_at (no version)', async () => {
    await createComment(client, makeComment());
    const edited = await editComment(client, 'c1', { body: 'updated' }, NOW);
    expect(edited.body).toBe('updated');
    expect(edited.edited_at).toBe(NOW);
    // A second edit just wins; no version check exists.
    const again = await editComment(client, 'c1', { body: 'final' }, NOW);
    expect(again.body).toBe('final');
  });

  it('archiveComment is idempotent', async () => {
    await createComment(client, makeComment());
    const first = await archiveComment(client, 'c1', NOW);
    expect(first.changed).toBe(true);
    expect(first.comment.archived_at).toBe(NOW);
    const second = await archiveComment(client, 'c1', NOW);
    expect(second.changed).toBe(false);
  });

  it('listComments returns active comments oldest-first, filters by parent_id', async () => {
    await createComment(client, makeComment({ id: 'c1', created_at: '2026-05-01T00:00:00Z' }));
    await createComment(
      client,
      makeComment({ id: 'c2', parent_id: 'c1', created_at: '2026-05-02T00:00:00Z' }),
    );
    await createComment(client, makeComment({ id: 'c3', created_at: '2026-05-03T00:00:00Z' }));
    await archiveComment(client, 'c3', NOW);

    const all = await listComments(client, 'task-1');
    expect(all.results.map((c) => c.id)).toEqual(['c1', 'c2']); // c3 archived, hidden

    const roots = await listComments(client, 'task-1', { parent_id: null });
    expect(roots.results.map((c) => c.id)).toEqual(['c1']);

    const replies = await listComments(client, 'task-1', { parent_id: 'c1' });
    expect(replies.results.map((c) => c.id)).toEqual(['c2']);
  });

  it('listComments paginates', async () => {
    for (let n = 1; n <= 4; n++) {
      await createComment(
        client,
        makeComment({ id: `c${n}`, created_at: `2026-05-0${n}T00:00:00Z` }),
      );
    }
    const p1 = await listComments(client, 'task-1', {}, { page_size: 2 });
    expect(p1.results.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(p1.pagination.has_more).toBe(true);
    const p2 = await listComments(
      client,
      'task-1',
      {},
      { cursor: p1.pagination.next_cursor!, page_size: 2 },
    );
    expect(p2.results.map((c) => c.id)).toEqual(['c3', 'c4']);
  });

  it('rejects a comment with corrupt custom_data on read', async () => {
    await client.execute({
      sql: `INSERT INTO comments (id, task_id, body, custom_data, created_by_agent, created_at) VALUES ('bad','task-1','x','{not json','a','2026-01-01T00:00:00Z')`,
    });
    await expect(getComment(client, 'bad')).rejects.toMatchObject({ code: 'internal_error' });
  });
});
