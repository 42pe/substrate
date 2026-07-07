import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rmrf } from '../../../tests/helpers/tmp.js';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeConfig } from '../../shared/config.js';
import { paths } from '../../shared/paths.js';
import { createBoardFile } from '../../substrate/writer.js';
import { validateCommand } from './validate.js';
import type { Board, Config, Policy } from '../../core/types.js';

const config: Config = {
  project_id: '11111111-1111-4111-8111-111111111111',
  project_name: 'P',
  description: '',
  version: 1,
  schema_version: 2,
  created_at: '2026-05-09T00:00:00.000Z',
};

function board(policies: Policy[] = []): Board {
  return {
    id: 'b',
    name: 'B',
    description: '',
    field_schema: { task: {}, comments: {} },
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
    policies,
    version: 1,
    created_at: '2026-05-09T00:00:00.000Z',
    updated_at: '2026-05-09T00:00:00.000Z',
    archived_at: null,
  };
}

function guard(def: Record<string, unknown>): Policy {
  return {
    id: 'g',
    name: 'Guard',
    description: '',
    type: 'transition_guard',
    definition: def,
    priority: 0,
    enabled: true,
    version: 1,
    created_by_agent: 't',
    created_at: '2026-05-09T00:00:00.000Z',
    updated_at: '2026-05-09T00:00:00.000Z',
    archived_at: null,
  };
}

describe('validateCommand', () => {
  let dir: string;
  let out: string[];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'substrate-validate-'));
    out = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      out.push(String(chunk));
      return true;
    });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    process.exitCode = 0;
    await rmrf(dir);
  });

  async function write(b: Board): Promise<void> {
    const root = join(dir, '.substrate');
    await writeConfig(root, config);
    await mkdir(paths(root).boardsDir, { recursive: true });
    await createBoardFile(root, b);
  }

  it('reports a clean substrate as valid with no warnings', async () => {
    await write(
      board([
        guard({
          from_group: 'todo',
          to_group: 'done',
          require: [{ field: 'task.custom_data.x', op: 'exists' }],
        }),
      ]),
    );
    await validateCommand(dir);
    expect(out.join('')).toMatch(/valid, no warnings/);
  });

  it('warns on a from_group === to_group guard (never fires on a real move)', async () => {
    await write(
      board([
        guard({
          from_group: 'todo',
          to_group: 'todo',
          require: [{ field: 'task.custom_data.x', op: 'exists' }],
        }),
      ]),
    );
    await validateCommand(dir);
    expect(out.join('')).toMatch(/⚠.*from_group === to_group/);
  });
});
