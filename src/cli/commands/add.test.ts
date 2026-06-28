import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { rmrfSync } from '../../../tests/helpers/tmp.js';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { addCommand } from './add.js';
import { initCommand } from './init.js';
import { loadSubstrate } from '../../substrate/loader.js';
import { paths, substrateRootFromCwd } from '../../shared/paths.js';
import { SubstrateError } from '../../core/errors.js';

const CLI = resolve(import.meta.dirname, '..', 'index.ts');

function board(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
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
    ...extra,
  };
}

describe('addCommand', () => {
  let cwd: string;
  let out: string[];

  function output(): string {
    return out.join('');
  }
  /** A template dir (convention mode) holding the given boards under boards/. */
  function makeTemplate(boards: Record<string, unknown>[]): string {
    const tdir = mkdtempSync(join(tmpdir(), 'substrate-tmpl-'));
    mkdirSync(join(tdir, 'boards'), { recursive: true });
    for (const b of boards)
      writeFileSync(join(tdir, 'boards', `${String(b['id'])}.json`), JSON.stringify(b));
    return tdir;
  }
  function boardsDirFiles(): string[] {
    return readdirSync(paths(substrateRootFromCwd(cwd)).boardsDir).sort();
  }
  async function expectError(fn: () => Promise<void>, code: string, match?: RegExp): Promise<void> {
    try {
      await fn();
      expect.unreachable('expected a throw');
    } catch (e) {
      expect(SubstrateError.is(e) && e.code).toBe(code);
      if (match) expect((e as Error).message).toMatch(match);
    }
  }

  beforeEach(async () => {
    cwd = mkdtempSync(join(tmpdir(), 'substrate-addcmd-'));
    await initCommand(cwd); // fresh blank substrate (no boards)
    out = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => {
      out.push(String(s));
      return true;
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmrfSync(cwd);
  });

  it('dry-run (no --yes) prints the preview and writes NO board files', async () => {
    const before = boardsDirFiles();
    const t = makeTemplate([board('delivery')]);
    await addCommand(cwd, t, {});
    expect(output()).toContain('Boards to add (1)');
    expect(output()).toContain('delivery');
    expect(output()).toContain('Dry run — nothing written. Re-run with --yes to apply.');
    expect(boardsDirFiles()).toEqual(before); // byte-for-byte unchanged
    rmrfSync(t);
  });

  it('--yes writes the board and loadSubstrate accepts the merged substrate', async () => {
    const t = makeTemplate([board('delivery')]);
    await addCommand(cwd, t, { yes: true });
    expect(output()).toContain('Applied 1 board(s)');
    expect(existsSync(paths(substrateRootFromCwd(cwd)).boardJson('delivery'))).toBe(true);
    const sub = await loadSubstrate(substrateRootFromCwd(cwd));
    expect(sub.boards.map((b) => b.id)).toContain('delivery');
    rmrfSync(t);
  });

  it('refuses a collision and writes nothing', async () => {
    const t = makeTemplate([board('delivery')]);
    await addCommand(cwd, t, { yes: true }); // apply once
    out = [];
    const before = boardsDirFiles();
    await expectError(() => addCommand(cwd, t, { yes: true }), 'conflict', /already exists/);
    expect(boardsDirFiles()).toEqual(before);
    rmrfSync(t);
  });

  it('--as renames a single-board template on apply', async () => {
    const t = makeTemplate([board('delivery')]);
    await addCommand(cwd, t, { yes: true, as: 'delivery2' });
    expect(existsSync(paths(substrateRootFromCwd(cwd)).boardJson('delivery2'))).toBe(true);
    const sub = await loadSubstrate(substrateRootFromCwd(cwd));
    expect(sub.boards.map((b) => b.id)).toContain('delivery2');
    rmrfSync(t);
  });

  it('--as is rejected for a multi-board template (before any write)', async () => {
    const t = makeTemplate([board('a'), board('b')]);
    await expectError(
      () => addCommand(cwd, t, { yes: true, as: 'x' }),
      'schema_violation',
      /renames a single board/,
    );
    rmrfSync(t);
  });

  it('--as onto an already-existing id refuses (collision on the renamed id)', async () => {
    await addCommand(cwd, makeTemplate([board('taken')]), { yes: true });
    out = [];
    const t = makeTemplate([board('delivery')]);
    await expectError(
      () => addCommand(cwd, t, { yes: true, as: 'taken' }),
      'conflict',
      /already exists/,
    );
    rmrfSync(t);
  });

  it('--as with an unsafe id is rejected with the rename-specific message (not writer.ts not_found)', async () => {
    const t = makeTemplate([board('delivery')]);
    await expectError(
      () => addCommand(cwd, t, { yes: true, as: '../evil' }),
      'schema_violation',
      /is not a valid board id/,
    );
    rmrfSync(t);
  });

  it('aborts attributing failure to the EXISTING substrate when it is invalid (B3)', async () => {
    // Corrupt the existing substrate so loadSubstrate throws BEFORE the template resolves.
    writeFileSync(join(paths(substrateRootFromCwd(cwd)).boardsDir, 'broken.json'), '{ not json');
    const t = makeTemplate([board('delivery')]);
    await expectError(
      () => addCommand(cwd, t, { yes: true }),
      'conflict',
      /Your existing substrate is invalid/,
    );
    rmrfSync(t);
  });

  it('errors with the init hint when there is no .substrate/', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'substrate-noinit-'));
    await expectError(
      () => addCommand(empty, makeTemplate([board('x')]), {}),
      'not_found',
      /substrate init/,
    );
    rmrfSync(empty);
  });

  it('preview counts groups + the two real policy types', async () => {
    const t = makeTemplate([
      board('counted', {
        groups: [
          {
            id: 'g1',
            name: 'A',
            description: '',
            position: 0,
            color: null,
            version: 1,
            archived_at: null,
          },
          {
            id: 'g2',
            name: 'B',
            description: '',
            position: 1,
            color: null,
            version: 1,
            archived_at: null,
          },
        ],
        policies: [
          {
            id: 'p1',
            name: 'guard',
            description: '',
            type: 'transition_guard',
            definition: { from_group: '*', to_group: '*' },
            priority: 0,
            enabled: true,
            version: 1,
            created_by_agent: 's',
            created_at: 't',
            updated_at: 't',
            archived_at: null,
          },
          {
            id: 'p2',
            name: 'resp',
            description: '',
            type: 'agent_responsibility',
            definition: { message: 'remember' },
            priority: 0,
            enabled: true,
            version: 1,
            created_by_agent: 's',
            created_at: 't',
            updated_at: 't',
            archived_at: null,
          },
        ],
      }),
    ]);
    await addCommand(cwd, t, {});
    expect(output()).toMatch(
      /2 group\(s\), 2 policy\(ies\) \(1 transition_guard, 1 agent_responsibility\)/,
    );
    rmrfSync(t);
  });

  // --- C5: dispatcher arg-parsing order (positional + --as value-flag) ---
  it('parses `add <dir> --as foo --yes` and `add --as foo <dir> --yes` identically (C5)', () => {
    const t = makeTemplate([board('delivery')]);
    for (const args of [
      ['add', t, '--as', 'renamed', '--yes'],
      ['add', '--as', 'renamed', t, '--yes'],
    ]) {
      const fresh = mkdtempSync(join(tmpdir(), 'substrate-c5-'));
      spawnSync('npx', ['tsx', CLI, 'init'], { cwd: fresh, encoding: 'utf-8' });
      const res = spawnSync('npx', ['tsx', CLI, ...args], { cwd: fresh, encoding: 'utf-8' });
      expect(res.status, res.stderr).toBe(0);
      expect(existsSync(join(fresh, '.substrate', 'boards', 'renamed.json'))).toBe(true);
      rmrfSync(fresh);
    }
    rmrfSync(t);
  }, 30_000);
});
