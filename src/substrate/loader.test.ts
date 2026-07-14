import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmrf } from '../../tests/helpers/tmp.js';
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
    await rmrf(dir);
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

  // --- Member registry: LENIENT loading (warn + skip, never fatal) ---

  async function writeMemberFile(filename: string, content: unknown): Promise<void> {
    const membersDir = paths(root).membersDir;
    await mkdir(membersDir, { recursive: true });
    await writeFile(
      join(membersDir, filename),
      typeof content === 'string' ? content : JSON.stringify(content, null, 2),
      'utf-8',
    );
  }

  it('populates Substrate.members from members/*.json', async () => {
    await writeBoardFile('board-a.json', makeBoard('board-a'));
    await writeMemberFile('alice.json', { id: 'alice', name: 'Alice', traits: ['x'] });
    await writeMemberFile('bob.json', { id: 'bob', name: 'Bob' });

    const substrate = await loadSubstrate(root);
    expect(substrate.members.map((m) => m.id).sort()).toEqual(['alice', 'bob']);
    expect(substrate.warnings).toEqual([]);
  });

  it('returns members: [] when members/ is missing', async () => {
    await writeBoardFile('board-a.json', makeBoard('board-a'));
    const substrate = await loadSubstrate(root);
    expect(substrate.members).toEqual([]);
    expect(substrate.warnings).toEqual([]);
  });

  it('warns + skips a malformed member file (bad JSON) — load still succeeds', async () => {
    await writeBoardFile('board-a.json', makeBoard('board-a'));
    await writeMemberFile('good.json', { id: 'good', name: 'Good' });
    await writeMemberFile('broken.json', '{not valid json');

    const substrate = await loadSubstrate(root);
    expect(substrate.members.map((m) => m.id)).toEqual(['good']);
    expect(substrate.warnings.some((w) => w.includes('members/broken.json'))).toBe(true);
  });

  it('warns + skips a member missing required fields — load still succeeds', async () => {
    await writeBoardFile('board-a.json', makeBoard('board-a'));
    await writeMemberFile('nameless.json', { id: 'nameless' }); // no name
    const substrate = await loadSubstrate(root);
    expect(substrate.members).toEqual([]);
    expect(substrate.warnings.some((w) => w.includes('members/nameless.json'))).toBe(true);
  });

  it('warns + skips a member whose filename does not match its id', async () => {
    await writeBoardFile('board-a.json', makeBoard('board-a'));
    await writeMemberFile('wrong-name.json', { id: 'actual', name: 'Actual' });
    const substrate = await loadSubstrate(root);
    expect(substrate.members).toEqual([]);
    expect(substrate.warnings.some((w) => w.includes('members/wrong-name.json'))).toBe(true);
  });

  it('loads members even when boards/ is missing', async () => {
    await writeMemberFile('solo.json', { id: 'solo', name: 'Solo' });
    const substrate = await loadSubstrate(root);
    expect(substrate.boards).toEqual([]);
    expect(substrate.members.map((m) => m.id)).toEqual(['solo']);
  });

  it('warns (does NOT throw) on a board team referencing an unknown member', async () => {
    await writeBoardFile(
      'board-a.json',
      makeBoard('board-a', { team: [{ member: 'ghost', groups: ['g1'] }] }),
    );
    const substrate = await loadSubstrate(root);
    expect(substrate.boards).toHaveLength(1); // still loaded
    expect(substrate.warnings.some((w) => w.includes('ghost'))).toBe(true);
  });
});
