import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from '@libsql/client';
import { openDatabaseAndMigrate } from '../client.js';
import { appendEvent, listEvents, type NewTaskEvent } from './events.js';

function makeEvent(overrides: Partial<NewTaskEvent> = {}): NewTaskEvent {
  return {
    task_id: 'task-1',
    event_type: 'created',
    changes: {},
    actor_agent_name: 'tester',
    occurred_at: '2026-05-09T00:00:00.000Z',
    ...overrides,
  };
}

describe('events repository', () => {
  let client: Client;
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'substrate-events-'));
    client = await openDatabaseAndMigrate(join(dir, '.substrate', 'data.sqlite'));
  });
  afterEach(async () => {
    client.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('appendEvent assigns a numeric id and round-trips fields', async () => {
    const ev = await appendEvent(client, makeEvent({ changes: { title: 'x' } }));
    expect(typeof ev.id).toBe('number');
    expect(ev.id).toBeGreaterThan(0);
    expect(ev.task_id).toBe('task-1');
    expect(ev.event_type).toBe('created');
    expect(ev.changes).toEqual({ title: 'x' });

    const { results } = await listEvents(client, 'task-1');
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual(ev);
  });

  it('assigns monotonically increasing ids', async () => {
    const a = await appendEvent(client, makeEvent());
    const b = await appendEvent(client, makeEvent());
    expect(b.id).toBeGreaterThan(a.id);
  });

  it('listEvents orders by occurred_at, then id as tiebreaker', async () => {
    // Same occurred_at on purpose; id must break the tie deterministically.
    const e1 = await appendEvent(client, makeEvent({ occurred_at: '2026-05-09T00:00:00.000Z' }));
    const e2 = await appendEvent(client, makeEvent({ occurred_at: '2026-05-09T00:00:00.000Z' }));
    const e0 = await appendEvent(client, makeEvent({ occurred_at: '2026-05-08T00:00:00.000Z' }));

    const { results } = await listEvents(client, 'task-1');
    expect(results.map((e) => e.id)).toEqual([e0.id, e1.id, e2.id]);
  });

  it('filters by event_types', async () => {
    await appendEvent(client, makeEvent({ event_type: 'created' }));
    await appendEvent(client, makeEvent({ event_type: 'updated' }));
    await appendEvent(client, makeEvent({ event_type: 'archived' }));

    const { results } = await listEvents(client, 'task-1', {
      event_types: ['updated', 'archived'],
    });
    expect(results.map((e) => e.event_type)).toEqual(['updated', 'archived']);
  });

  it('filters by since / until (inclusive)', async () => {
    await appendEvent(client, makeEvent({ occurred_at: '2026-05-01T00:00:00.000Z' }));
    await appendEvent(client, makeEvent({ occurred_at: '2026-05-05T00:00:00.000Z' }));
    await appendEvent(client, makeEvent({ occurred_at: '2026-05-10T00:00:00.000Z' }));

    const since = await listEvents(client, 'task-1', { since: '2026-05-05T00:00:00.000Z' });
    expect(since.results.map((e) => e.occurred_at)).toEqual([
      '2026-05-05T00:00:00.000Z',
      '2026-05-10T00:00:00.000Z',
    ]);

    const until = await listEvents(client, 'task-1', { until: '2026-05-05T00:00:00.000Z' });
    expect(until.results.map((e) => e.occurred_at)).toEqual([
      '2026-05-01T00:00:00.000Z',
      '2026-05-05T00:00:00.000Z',
    ]);
  });

  it('scopes events to the requested task', async () => {
    await appendEvent(client, makeEvent({ task_id: 'task-1' }));
    await appendEvent(client, makeEvent({ task_id: 'task-2' }));

    const { results } = await listEvents(client, 'task-1');
    expect(results).toHaveLength(1);
    expect(results[0]!.task_id).toBe('task-1');
  });

  it('paginates with a stable cursor (id tiebreaker)', async () => {
    for (let n = 1; n <= 4; n++) {
      await appendEvent(client, makeEvent({ occurred_at: `2026-05-0${n}T00:00:00.000Z` }));
    }
    const p1 = await listEvents(client, 'task-1', {}, { page_size: 2 });
    expect(p1.results.map((e) => e.occurred_at)).toEqual([
      '2026-05-01T00:00:00.000Z',
      '2026-05-02T00:00:00.000Z',
    ]);
    expect(p1.pagination.has_more).toBe(true);

    const p2 = await listEvents(
      client,
      'task-1',
      {},
      { cursor: p1.pagination.next_cursor!, page_size: 2 },
    );
    expect(p2.results.map((e) => e.occurred_at)).toEqual([
      '2026-05-03T00:00:00.000Z',
      '2026-05-04T00:00:00.000Z',
    ]);
    expect(p2.pagination.has_more).toBe(false);
  });

  it('rejects an event with corrupt changes JSON on read', async () => {
    await client.execute({
      sql: `INSERT INTO task_events (task_id, event_type, changes, actor_agent_name, occurred_at) VALUES ('task-1','created','{not json','a','2026-01-01T00:00:00Z')`,
    });
    await expect(listEvents(client, 'task-1')).rejects.toMatchObject({ code: 'internal_error' });
  });
});
