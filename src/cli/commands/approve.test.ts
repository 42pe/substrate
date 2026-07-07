import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmrf } from '../../../tests/helpers/tmp.js';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from '@libsql/client';
import { writeConfig } from '../../shared/config.js';
import { paths } from '../../shared/paths.js';
import { createBoardFile } from '../../substrate/writer.js';
import { openDatabaseAndMigrate } from '../../storage/client.js';
import { createTask, getTask } from '../../storage/repositories/tasks.js';
import { listEvents } from '../../storage/repositories/events.js';
import { resetFileSink } from '../../shared/logger.js';
import { approveCommand } from './approve.js';
import { SubstrateError } from '../../core/errors.js';
import type { Board, Config, Task } from '../../core/types.js';

const config: Config = {
  project_id: '11111111-1111-4111-8111-111111111111',
  project_name: 'Proj',
  description: '',
  version: 1,
  schema_version: 2,
  created_at: '2026-05-09T00:00:00.000Z',
};

const board: Board = {
  id: 'b',
  name: 'Board B',
  description: '',
  field_schema: {
    task: {
      severity: { type: 'enum', values: ['low', 'high'] },
      plan_approved: { type: 'boolean', human_only: true },
    },
    comments: {},
  },
  groups: [
    {
      id: 'g',
      name: 'Group',
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

function makeTask(): Task {
  return {
    id: 't1',
    board_id: 'b',
    group_id: 'g',
    parent_id: null,
    origin_task_id: null,
    title: 'Task',
    description: '',
    custom_data: {},
    version: 1,
    created_by_agent: 'tester',
    created_at: '2026-05-09T00:00:00.000Z',
    updated_at: '2026-05-09T00:00:00.000Z',
    archived_at: null,
  };
}

describe('approveCommand (B3 human channel)', () => {
  let dir: string;
  let client: Client;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'substrate-approve-'));
    const root = join(dir, '.substrate');
    await writeConfig(root, config);
    await mkdir(paths(root).boardsDir, { recursive: true });
    await createBoardFile(root, board);
    client = await openDatabaseAndMigrate(paths(root).dataSqlite);
    await createTask(client, makeTask());
  });
  afterEach(async () => {
    client.close();
    resetFileSink();
    await rmrf(dir);
  });

  it('sets a human_only field and stamps a human actor', async () => {
    await approveCommand(dir, { taskId: 't1', field: 'plan_approved' });
    const t = await getTask(client, 't1');
    expect(t.custom_data['plan_approved']).toBe(true); // default value = true
    expect(t.version).toBe(2);
    const { results } = await listEvents(client, 't1');
    const updated = results.find((e) => e.event_type === 'updated');
    expect(updated?.actor_agent_name).toMatch(/^human:/);
  });

  it('parses a provided value (JSON when possible)', async () => {
    await approveCommand(dir, { taskId: 't1', field: 'plan_approved', value: 'false' });
    const t = await getTask(client, 't1');
    expect(t.custom_data['plan_approved']).toBe(false);
  });

  it('refuses a field that is not human_only (schema_violation)', async () => {
    await expect(
      approveCommand(dir, { taskId: 't1', field: 'severity', value: 'low' }),
    ).rejects.toMatchObject({ code: 'schema_violation' });
  });

  it('not_found on a missing task', async () => {
    await expect(approveCommand(dir, { taskId: 'gone', field: 'plan_approved' })).rejects.toThrow(
      SubstrateError,
    );
  });
});
