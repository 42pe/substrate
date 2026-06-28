import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmrf } from '../../../../tests/helpers/tmp.js';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from '@libsql/client';
import { openDatabaseAndMigrate } from '../../../storage/client.js';
import { appendEvent } from '../../../storage/repositories/events.js';
import { getTaskHistoryHandler } from './get-task-history.js';
import type { ToolDeps } from '../../deps.js';
import type { Config } from '../../../core/types.js';

const fixtureConfig: Config = {
  project_id: '00000000-0000-4000-8000-000000000001',
  project_name: 'TestProject',
  description: '',
  version: 1,
  schema_version: 2,
  created_at: '2026-05-09T00:00:00.000Z',
};

describe('getTaskHistoryHandler', () => {
  let client: Client;
  let dir: string;
  let deps: ToolDeps;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'substrate-task-history-'));
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
    await rmrf(dir);
  });

  it('returns events oldest-first', async () => {
    await appendEvent(client, {
      task_id: 't1',
      event_type: 'created',
      changes: {},
      actor_agent_name: 'a',
      occurred_at: '2026-05-01T00:00:00.000Z',
    });
    await appendEvent(client, {
      task_id: 't1',
      event_type: 'updated',
      changes: {},
      actor_agent_name: 'a',
      occurred_at: '2026-05-02T00:00:00.000Z',
    });
    const r = await getTaskHistoryHandler({ task_id: 't1' }, deps);
    expect(r.results.map((e) => e.event_type)).toEqual(['created', 'updated']);
  });

  it('filters by event_types', async () => {
    for (const t of ['created', 'updated', 'archived'] as const) {
      await appendEvent(client, {
        task_id: 't1',
        event_type: t,
        changes: {},
        actor_agent_name: 'a',
        occurred_at: '2026-05-01T00:00:00.000Z',
      });
    }
    const r = await getTaskHistoryHandler(
      { task_id: 't1', filters: { event_types: ['archived'] } },
      deps,
    );
    expect(r.results.map((e) => e.event_type)).toEqual(['archived']);
  });

  it('returns an empty page for a task with no events', async () => {
    const r = await getTaskHistoryHandler({ task_id: 'unknown' }, deps);
    expect(r.results).toEqual([]);
    expect(r.pagination.has_more).toBe(false);
  });
});
