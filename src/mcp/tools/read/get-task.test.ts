import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from '@libsql/client';
import { openDatabaseAndMigrate } from '../../../storage/client.js';
import { createTask } from '../../../storage/repositories/tasks.js';
import { getTaskToolHandler } from './get-task.js';
import type { ToolDeps } from '../../deps.js';
import type { Config, Task } from '../../../core/types.js';

const fixtureConfig: Config = {
  project_id: '00000000-0000-4000-8000-000000000001',
  project_name: 'TestProject',
  description: '',
  version: 1,
  schema_version: 2,
  created_at: '2026-05-09T00:00:00.000Z',
};

function makeTask(id: string): Task {
  return {
    id,
    board_id: 'board-1',
    group_id: 'g1',
    parent_id: null,
    origin_task_id: null,
    title: 'Hello',
    description: '',
    custom_data: {},
    version: 1,
    created_by_agent: 'tester',
    created_at: '2026-05-09T00:00:00.000Z',
    updated_at: '2026-05-09T00:00:00.000Z',
    archived_at: null,
  };
}

describe('getTaskToolHandler', () => {
  let client: Client;
  let dir: string;
  let deps: ToolDeps;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'substrate-get-task-'));
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
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it('returns the task including its version', async () => {
    await createTask(client, makeTask('t1'));
    const task = await getTaskToolHandler({ id: 't1' }, deps);
    expect(task.id).toBe('t1');
    expect(task.version).toBe(1);
  });

  it('throws not_found for a missing task', async () => {
    await expect(getTaskToolHandler({ id: 'nope' }, deps)).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});
