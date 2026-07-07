import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rmrf } from '../../../tests/helpers/tmp.js';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from '@libsql/client';
import { writeConfig } from '../../shared/config.js';
import { paths } from '../../shared/paths.js';
import { createBoardFile } from '../../substrate/writer.js';
import { openDatabaseAndMigrate } from '../../storage/client.js';
import { createTask } from '../../storage/repositories/tasks.js';
import { resetFileSink } from '../../shared/logger.js';
import { pendingApprovalCommand } from './pending-approval.js';
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
  name: 'Delivery',
  description: '',
  field_schema: { task: { plan_approved: { type: 'boolean', human_only: true } }, comments: {} },
  groups: [
    {
      id: 'todo',
      name: 'Todo',
      description: '',
      position: 0,
      color: null,
      version: 1,
      archived_at: null,
    },
    {
      id: 'done',
      name: 'Done',
      description: '',
      position: 1,
      color: null,
      version: 1,
      archived_at: null,
    },
  ],
  policies: [
    {
      id: 'gate',
      name: 'Approval gate',
      description: '',
      type: 'transition_guard',
      definition: {
        from_group: 'todo',
        to_group: 'done',
        require: [{ field: 'task.custom_data.plan_approved', op: 'exists' }],
      },
      priority: 0,
      enabled: true,
      version: 1,
      created_by_agent: 't',
      created_at: '2026-05-09T00:00:00.000Z',
      updated_at: '2026-05-09T00:00:00.000Z',
      archived_at: null,
    },
  ],
  version: 1,
  created_at: '2026-05-09T00:00:00.000Z',
  updated_at: '2026-05-09T00:00:00.000Z',
  archived_at: null,
};

function makeTask(over: Partial<Task>): Task {
  return {
    id: 't',
    board_id: 'b',
    group_id: 'todo',
    parent_id: null,
    origin_task_id: null,
    title: 't',
    description: '',
    custom_data: {},
    version: 1,
    created_by_agent: 't',
    created_at: '2026-05-09T00:00:00.000Z',
    updated_at: '2026-05-09T00:00:00.000Z',
    archived_at: null,
    ...over,
  };
}

describe('pendingApprovalCommand', () => {
  let dir: string;
  let client: Client;
  let out: string[];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'substrate-pa-cli-'));
    const root = join(dir, '.substrate');
    await writeConfig(root, config);
    await mkdir(paths(root).boardsDir, { recursive: true });
    await createBoardFile(root, board);
    client = await openDatabaseAndMigrate(paths(root).dataSqlite);
    out = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      out.push(String(chunk));
      return true;
    });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    resetFileSink();
    client.close();
    await rmrf(dir);
  });

  it('lists a pending task grouped by board with the unblock command', async () => {
    await createTask(client, makeTask({ id: 'needsme', title: 'Ship it' }));
    await pendingApprovalCommand(dir);
    const text = out.join('');
    expect(text).toContain('1 task(s) pending human approval');
    expect(text).toContain('Delivery'); // board name
    expect(text).toContain('Ship it');
    expect(text).toContain('plan_approved');
    expect(text).toContain('substrate approve needsme plan_approved');
  });

  it('reports nothing pending when all gates are satisfied', async () => {
    await createTask(client, makeTask({ id: 'ok', custom_data: { plan_approved: true } }));
    await pendingApprovalCommand(dir);
    expect(out.join('')).toContain('No tasks pending human approval');
  });
});
