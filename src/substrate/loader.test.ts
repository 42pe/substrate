import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSubstrate } from './loader.js';
import { writeConfig } from '../shared/config.js';
import { paths } from '../shared/paths.js';
import type { Board, Config } from '../core/types.js';
import { SubstrateError } from '../core/errors.js';

const CONFIG: Config = {
  project_id: '11111111-1111-4111-8111-111111111111',
  project_name: 'test',
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
    groups: [
      {
        id: 'g1',
        name: 'Group 1',
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
    ...overrides,
  };
}

describe('loadSubstrate', () => {
  let dir: string;
  let root: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'substrate-loader-'));
    root = join(dir, '.substrate');
    await writeConfig(root, CONFIG);
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  async function writeBoardFile(filename: string, content: unknown): Promise<void> {
    const boardsDir = paths(root).boardsDir;
    await mkdir(boardsDir, { recursive: true });
    await writeFile(
      join(boardsDir, filename),
      typeof content === 'string' ? content : JSON.stringify(content, null, 2),
      'utf-8',
    );
  }

  it('loads config + multiple boards', async () => {
    await writeBoardFile('board-a.json', makeBoard('board-a'));
    await writeBoardFile('board-b.json', makeBoard('board-b'));

    const substrate = await loadSubstrate(root);
    expect(substrate.config.project_id).toBe(CONFIG.project_id);
    expect(substrate.boards.map((b) => b.id).sort()).toEqual(['board-a', 'board-b']);
  });

  it('returns an empty boards list when boards/ is missing', async () => {
    const substrate = await loadSubstrate(root);
    expect(substrate.boards).toEqual([]);
  });

  it('ignores non-.json files in boards/', async () => {
    await writeBoardFile('board-a.json', makeBoard('board-a'));
    await writeBoardFile('README.md', '# not a board');
    const substrate = await loadSubstrate(root);
    expect(substrate.boards.map((b) => b.id)).toEqual(['board-a']);
  });

  it('strict-fails the whole load on a malformed JSON file', async () => {
    await writeBoardFile('board-a.json', makeBoard('board-a'));
    await writeBoardFile('broken.json', '{not valid json');
    let caught: unknown;
    try {
      await loadSubstrate(root);
    } catch (e) {
      caught = e;
    }
    expect(SubstrateError.is(caught)).toBe(true);
    if (SubstrateError.is(caught)) {
      expect(caught.code).toBe('substrate_corrupt');
      expect(caught.message).toContain('boards/broken.json');
    }
  });

  it('strict-fails on a shape mismatch with issues in details', async () => {
    await writeBoardFile('bad-shape.json', { id: 'x', name: 'missing the rest' });
    let caught: unknown;
    try {
      await loadSubstrate(root);
    } catch (e) {
      caught = e;
    }
    expect(SubstrateError.is(caught)).toBe(true);
    if (SubstrateError.is(caught)) {
      expect(caught.code).toBe('substrate_corrupt');
      expect(caught.message).toContain('boards/bad-shape.json');
      expect(caught.details).toHaveProperty('issues');
    }
  });

  it('propagates cross-board validator failures (duplicate group id)', async () => {
    const board = makeBoard('board-a', {
      groups: [
        {
          id: 'dup',
          name: 'A',
          description: '',
          position: 0,
          color: null,
          version: 1,
          archived_at: null,
        },
        {
          id: 'dup',
          name: 'B',
          description: '',
          position: 1,
          color: null,
          version: 1,
          archived_at: null,
        },
      ],
    });
    await writeBoardFile('board-a.json', board);
    await expect(loadSubstrate(root)).rejects.toMatchObject({ code: 'substrate_corrupt' });
  });

  it('throws not_found when config.json is missing', async () => {
    await rm(paths(root).config, { force: true });
    await expect(loadSubstrate(root)).rejects.toMatchObject({ code: 'not_found' });
  });
});
