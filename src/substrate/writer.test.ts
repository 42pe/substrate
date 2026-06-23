import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBoardFile, mutateBoardFile, mutateConfig, findBoardHolding } from './writer.js';
import { writeConfig } from '../shared/config.js';
import { paths } from '../shared/paths.js';
import type { Board, Config, Substrate } from '../core/types.js';

const config: Config = {
  project_id: '11111111-1111-4111-8111-111111111111',
  project_name: 'test',
  description: '',
  version: 1,
  schema_version: 2,
  created_at: '2026-05-09T00:00:00.000Z',
};

function makeBoard(id: string): Board {
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
  };
}

describe('substrate writer', () => {
  let dir: string;
  let root: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'substrate-writer-'));
    root = join(dir, '.substrate');
    await writeConfig(root, config);
    await mkdir(paths(root).boardsDir, { recursive: true });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it('createBoardFile writes a new board atomically', async () => {
    await createBoardFile(root, makeBoard('b1'));
    const raw = await readFile(paths(root).boardJson('b1'), 'utf-8');
    expect(JSON.parse(raw).id).toBe('b1');
  });

  it('createBoardFile rejects an existing board with conflict (wx)', async () => {
    await createBoardFile(root, makeBoard('b1'));
    await expect(createBoardFile(root, makeBoard('b1'))).rejects.toMatchObject({
      code: 'conflict',
    });
  });

  it('mutateBoardFile round-trips a mutation and leaves no temp files', async () => {
    await createBoardFile(root, makeBoard('b1'));
    const result = await mutateBoardFile(root, 'b1', (board) => ({
      result: board.version,
      next: { ...board, name: 'Renamed', version: board.version + 1 },
    }));
    expect(result).toBe(1); // observed prior version
    const raw = JSON.parse(await readFile(paths(root).boardJson('b1'), 'utf-8'));
    expect(raw.name).toBe('Renamed');
    expect(raw.version).toBe(2);
    const files = await readdir(paths(root).boardsDir);
    expect(files.filter((f) => f.includes('.tmp-'))).toEqual([]); // temp cleaned
  });

  it('rejects a path-traversal board id (B1) without touching the filesystem', async () => {
    await expect(
      mutateBoardFile(root, '../../../../tmp/evil', (b) => ({ result: null, next: b })),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(createBoardFile(root, makeBoard('../escape'))).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('mutateBoardFile skips the write on an idempotent no-op (C2)', async () => {
    await createBoardFile(root, makeBoard('b1'));
    const before = await readFile(paths(root).boardJson('b1'), 'utf-8');
    // returning the same board reference signals no change → no write
    await mutateBoardFile(root, 'b1', (board) => ({ result: null, next: board }));
    const after = await readFile(paths(root).boardJson('b1'), 'utf-8');
    expect(after).toBe(before);
    const files = await readdir(paths(root).boardsDir);
    expect(files.filter((f) => f.includes('.tmp-'))).toEqual([]);
  });

  it('mutateBoardFile throws not_found for a missing board', async () => {
    await expect(
      mutateBoardFile(root, 'nope', (b) => ({ result: null, next: b })),
    ).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('mutateBoardFile rejects a corrupt board file (internal_error)', async () => {
    await writeFile(paths(root).boardJson('bad'), '{not json', 'utf-8');
    await expect(
      mutateBoardFile(root, 'bad', (b) => ({ result: null, next: b })),
    ).rejects.toMatchObject({
      code: 'internal_error',
    });
  });

  it('mutateConfig round-trips a config mutation', async () => {
    const v = await mutateConfig(root, (c) => ({
      result: c.version,
      next: { ...c, description: 'updated', version: c.version + 1 },
    }));
    expect(v).toBe(1);
    const raw = JSON.parse(await readFile(paths(root).config, 'utf-8'));
    expect(raw.description).toBe('updated');
    expect(raw.version).toBe(2);
  });

  it('findBoardHolding locates the board owning a group/policy id', () => {
    const b1: Board = {
      ...makeBoard('b1'),
      groups: [
        {
          id: 'g1',
          name: 'G',
          description: '',
          position: 0,
          color: null,
          version: 1,
          archived_at: null,
        },
      ],
    };
    const substrate: Substrate = { config, boards: [makeBoard('b0'), b1] };
    expect(findBoardHolding(substrate, 'g1', 'group')?.id).toBe('b1');
    expect(findBoardHolding(substrate, 'nope', 'group')).toBeNull();
  });
});
