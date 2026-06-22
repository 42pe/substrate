import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from '@libsql/client';
import { writeConfig } from '../../../shared/config.js';
import { paths } from '../../../shared/paths.js';
import { createBoardFile } from '../../../substrate/writer.js';
import { loadSubstrate } from '../../../substrate/loader.js';
import { openDatabaseAndMigrate } from '../../../storage/client.js';
import { createTask } from '../../../storage/repositories/tasks.js';
import { updateProjectHandler } from './update-project.js';
import { createBoardHandler } from './create-board.js';
import { updateBoardHandler } from './update-board.js';
import { archiveBoardHandler } from './archive-board.js';
import { unarchiveBoardHandler } from './unarchive-board.js';
import type { ToolDeps } from '../../deps.js';
import type { Board, Config, Task } from '../../../core/types.js';

const baseConfig: Config = {
  project_id: '11111111-1111-4111-8111-111111111111',
  project_name: 'Proj',
  description: '',
  version: 1,
  schema_version: 2,
  created_at: '2026-05-09T00:00:00.000Z',
};

function makeBoard(id: string, overrides: Partial<Board> = {}): Board {
  return {
    id,
    name: `Board ${id}`,
    description: '',
    field_schema: { task: {}, comments: {} },
    groups: [],
    policies: [],
    version: 1,
    created_at: '2026-05-09T00:00:00.000Z',
    updated_at: '2026-05-09T00:00:00.000Z',
    archived_at: null,
    ...overrides,
  };
}

function makeTask(id: string, boardId: string, groupId: string): Task {
  return {
    id,
    board_id: boardId,
    group_id: groupId,
    parent_id: null,
    origin_task_id: null,
    title: 't',
    description: '',
    custom_data: {},
    version: 1,
    created_by_agent: 'tester',
    created_at: '2026-05-09T00:00:00.000Z',
    updated_at: '2026-05-09T00:00:00.000Z',
    archived_at: null,
  };
}

describe('board + project edit tools', () => {
  let dir: string;
  let root: string;
  let client: Client;
  let deps: ToolDeps;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'substrate-board-edit-'));
    root = join(dir, '.substrate');
    await writeConfig(root, baseConfig);
    await mkdir(paths(root).boardsDir, { recursive: true });
    client = await openDatabaseAndMigrate(paths(root).dataSqlite);
    deps = {
      client,
      config: baseConfig,
      loadSubstrate: () => loadSubstrate(root),
      root,
    };
  });
  afterEach(async () => {
    client.close();
    await rm(dir, { recursive: true, force: true });
  });

  describe('update_project', () => {
    it('updates name/description and bumps config version', async () => {
      const env = await updateProjectHandler(
        { version: 1, name: 'Renamed', description: 'desc', agent_name: 'a' },
        deps,
      );
      if (!env.ok) throw new Error('expected success');
      expect(env.applied.entity).toBe('project');
      expect(env.applied.version).toBe(2);
      expect(env.applied.state.project_name).toBe('Renamed');
      const raw = JSON.parse(await readFile(paths(root).config, 'utf-8'));
      expect(raw.description).toBe('desc');
      expect(raw.version).toBe(2);
    });

    it('rejects a stale version with version_mismatch (no current_version)', async () => {
      await updateProjectHandler({ version: 1, name: 'A', agent_name: 'a' }, deps);
      const env = await updateProjectHandler({ version: 1, name: 'B', agent_name: 'a' }, deps);
      if (env.ok) throw new Error('expected error');
      expect(env.error.code).toBe('version_mismatch');
      expect(JSON.stringify(env.error)).not.toContain('current_version');
    });

    it('works through a defaulted version on a legacy config (C2)', async () => {
      // Legacy config.json (no version/description) → readConfig defaults version=1.
      const legacy = {
        project_id: baseConfig.project_id,
        project_name: 'Legacy',
        schema_version: 2,
        created_at: '2026-05-09T00:00:00.000Z',
      };
      await writeFile(paths(root).config, `${JSON.stringify(legacy, null, 2)}\n`, 'utf-8');
      const ok = await updateProjectHandler({ version: 1, name: 'New', agent_name: 'a' }, deps);
      if (!ok.ok) throw new Error('expected success');
      expect(ok.applied.version).toBe(2);
      const stale = await updateProjectHandler({ version: 1, name: 'X', agent_name: 'a' }, deps);
      if (stale.ok) throw new Error('expected version_mismatch');
      expect(stale.error.code).toBe('version_mismatch');
    });
  });

  describe('create_board', () => {
    it('writes a new board file with a generated uuid', async () => {
      const env = await createBoardHandler({ name: 'My Board', agent_name: 'a' }, deps);
      if (!env.ok) throw new Error('expected success');
      expect(env.applied.id).toMatch(/^[0-9a-f-]{36}$/i);
      expect(env.applied.version).toBe(1);
      const raw = JSON.parse(await readFile(paths(root).boardJson(env.applied.id), 'utf-8'));
      expect(raw.name).toBe('My Board');
    });

    it('rejects a malformed field_schema with schema_violation (no file written)', async () => {
      const env = await createBoardHandler(
        {
          name: 'Bad',
          field_schema: { task: { sev: { type: 'enum' } }, comments: {} },
          agent_name: 'a',
        },
        deps,
      );
      if (env.ok) throw new Error('expected error');
      expect(env.error.code).toBe('schema_violation');
    });

    it('rejects a project_id that is not the current project (not_found)', async () => {
      const env = await createBoardHandler(
        { name: 'X', project_id: 'other', agent_name: 'a' },
        deps,
      );
      if (env.ok) throw new Error('expected error');
      expect(env.error.code).toBe('not_found');
    });
  });

  describe('update_board / archive_board / unarchive_board', () => {
    beforeEach(async () => {
      await createBoardFile(root, makeBoard('b1'));
    });

    it('update_board patches and bumps version', async () => {
      const env = await updateBoardHandler(
        { id: 'b1', version: 1, name: 'Renamed', agent_name: 'a' },
        deps,
      );
      if (!env.ok) throw new Error('expected success');
      expect(env.applied.state.name).toBe('Renamed');
      expect(env.applied.version).toBe(2);
    });

    it('update_board with a stale version → version_mismatch', async () => {
      await updateBoardHandler({ id: 'b1', version: 1, name: 'A', agent_name: 'a' }, deps);
      const env = await updateBoardHandler(
        { id: 'b1', version: 1, name: 'B', agent_name: 'a' },
        deps,
      );
      if (env.ok) throw new Error('expected error');
      expect(env.error.code).toBe('version_mismatch');
    });

    it('update_board on a missing board → not_found', async () => {
      const env = await updateBoardHandler(
        { id: 'gone', version: 1, name: 'X', agent_name: 'a' },
        deps,
      );
      if (env.ok) throw new Error('expected error');
      expect(env.error.code).toBe('not_found');
    });

    it('archive_board sets archived_at, then is idempotent (no further bump)', async () => {
      const first = await archiveBoardHandler({ id: 'b1', version: 1, agent_name: 'a' }, deps);
      if (!first.ok) throw new Error('expected success');
      expect(first.applied.state.archived_at).not.toBeNull();
      expect(first.applied.version).toBe(2);
      const again = await archiveBoardHandler({ id: 'b1', version: 999, agent_name: 'a' }, deps);
      if (!again.ok) throw new Error('expected success');
      expect(again.applied.version).toBe(2); // no-op, no bump, no version check
    });

    it('archive_board with an active task → conflict (mirrors archive_group)', async () => {
      await createTask(client, makeTask('t1', 'b1', 'g1'));
      const env = await archiveBoardHandler({ id: 'b1', version: 1, agent_name: 'a' }, deps);
      if (env.ok) throw new Error('expected error');
      expect(env.error.code).toBe('conflict');
    });

    it('unarchive_board restores; idempotent on an active board', async () => {
      await archiveBoardHandler({ id: 'b1', version: 1, agent_name: 'a' }, deps);
      const env = await unarchiveBoardHandler({ id: 'b1', version: 2, agent_name: 'a' }, deps);
      if (!env.ok) throw new Error('expected success');
      expect(env.applied.state.archived_at).toBeNull();
      expect(env.applied.version).toBe(3);
      const noop = await unarchiveBoardHandler({ id: 'b1', version: 999, agent_name: 'a' }, deps);
      if (!noop.ok) throw new Error('expected success');
      expect(noop.applied.version).toBe(3);
    });
  });
});
