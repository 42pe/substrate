import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { rmrfSync } from '../../../tests/helpers/tmp.js';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addCommand } from './add.js';
import { initCommand } from './init.js';
import { paths, substrateRootFromCwd } from '../../shared/paths.js';

// Inject a writer fault: board 1 writes for real, board 2 throws — so the
// transactional rollback has a real file to unlink. (We do NOT pre-create
// board 2's file; a present-and-loadable board would be caught by the step-4
// pre-flight collision check and never reach the write loop — C4.)
const { createBoardFileMock } = vi.hoisted(() => ({ createBoardFileMock: vi.fn() }));
vi.mock('../../substrate/writer.js', async (orig) => {
  const actual = await orig<typeof import('../../substrate/writer.js')>();
  return { ...actual, createBoardFile: createBoardFileMock };
});

function board(id: string): Record<string, unknown> {
  return {
    id,
    name: id,
    description: '',
    field_schema: { task: {}, comments: {} },
    groups: [
      {
        id: 'g1',
        name: 'Todo',
        description: '',
        position: 0,
        color: null,
        version: 1,
        archived_at: null,
      },
    ],
    policies: [],
    version: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    archived_at: null,
  };
}

describe('addCommand transactional rollback', () => {
  let cwd: string;
  let tdir: string;

  beforeEach(async () => {
    cwd = mkdtempSync(join(tmpdir(), 'substrate-rollback-'));
    await initCommand(cwd); // bare init writes no boards → mock isn't exercised here
    tdir = mkdtempSync(join(tmpdir(), 'substrate-tmpl-'));
    mkdirSync(join(tdir, 'boards'), { recursive: true });
    writeFileSync(join(tdir, 'boards', 'a.json'), JSON.stringify(board('a')));
    writeFileSync(join(tdir, 'boards', 'b.json'), JSON.stringify(board('b')));
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    createBoardFileMock.mockReset();
    rmrfSync(cwd);
    rmrfSync(tdir);
  });

  it('rolls back board 1 when board 2 fails mid-apply, and rethrows the original error', async () => {
    const actual = await vi.importActual<typeof import('../../substrate/writer.js')>(
      '../../substrate/writer.js',
    );
    let calls = 0;
    createBoardFileMock.mockImplementation(
      async (root: string, b: Parameters<typeof actual.createBoardFile>[1]) => {
        calls += 1;
        if (calls === 2) throw new Error('injected write fault');
        return actual.createBoardFile(root, b);
      },
    );

    const boardsDir = paths(substrateRootFromCwd(cwd)).boardsDir;
    await expect(addCommand(cwd, tdir, { yes: true })).rejects.toThrow('injected write fault');

    // board 1 (a) was written then rolled back; board 2 (b) never landed.
    expect(existsSync(join(boardsDir, 'a.json'))).toBe(false);
    expect(existsSync(join(boardsDir, 'b.json'))).toBe(false);
    expect(calls).toBe(2);
  });
});
