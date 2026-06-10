import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { loadExternalTemplate } from './external.js';
import { SubstrateError } from '../../core/errors.js';

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

describe('loadExternalTemplate', () => {
  let dir: string;

  function write(rel: string, content: string): string {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
    return abs;
  }
  function writeBoard(rel: string, id: string, extra: Record<string, unknown> = {}): void {
    write(rel, JSON.stringify(board(id, extra)));
  }
  async function expectError(p: string, code: string, match?: RegExp): Promise<void> {
    try {
      await loadExternalTemplate(p);
      expect.unreachable(`expected ${p} to throw`);
    } catch (e) {
      expect(SubstrateError.is(e) && e.code).toBe(code);
      if (match) expect((e as Error).message).toMatch(match);
    }
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'substrate-ext-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // --- manifest mode ---
  it('manifest mode loads exactly the listed boards', async () => {
    writeBoard('boards/delivery.json', 'delivery');
    writeBoard('boards/extra.json', 'extra'); // present but NOT listed → ignored
    write(
      'substrate-template.json',
      JSON.stringify({
        name: 'X',
        description: 'd',
        version: '1',
        boards: ['boards/delivery.json'],
      }),
    );
    const r = await loadExternalTemplate(dir);
    expect(r.source).toBe('manifest');
    expect(r.boards.map((b) => b.id)).toEqual(['delivery']);
    expect(r.manifest?.name).toBe('X');
  });

  it('accepts the manifest FILE itself as the arg', async () => {
    writeBoard('boards/d.json', 'd');
    const mf = write(
      'substrate-template.json',
      JSON.stringify({ name: 'X', description: 'd', version: '1', boards: ['boards/d.json'] }),
    );
    const r = await loadExternalTemplate(mf);
    expect(r.boards.map((b) => b.id)).toEqual(['d']);
  });

  it('present-but-broken manifest → error, NOT convention fallback', async () => {
    writeBoard('.substrate/boards/d.json', 'd'); // convention would work…
    write('substrate-template.json', '{ not valid json');
    await expectError(dir, 'schema_violation', /Invalid JSON/);
  });

  it('manifest fails schema (unknown key) → schema_violation', async () => {
    writeBoard('boards/d.json', 'd');
    write(
      'substrate-template.json',
      JSON.stringify({
        name: 'X',
        description: 'd',
        version: '1',
        boards: ['boards/d.json'],
        bogus: 1,
      }),
    );
    await expectError(dir, 'schema_violation');
  });

  it('manifest board entry missing on disk → not_found naming the file', async () => {
    write(
      'substrate-template.json',
      JSON.stringify({ name: 'X', description: 'd', version: '1', boards: ['boards/ghost.json'] }),
    );
    await expectError(dir, 'not_found', /ghost\.json/);
  });

  it('manifest board path escaping the template dir → traversal error', async () => {
    writeBoard('outside.json', 'evil'); // sibling of dir? no — inside dir but referenced via ..
    write(
      'substrate-template.json',
      JSON.stringify({ name: 'X', description: 'd', version: '1', boards: ['../evil.json'] }),
    );
    // create the escape target in the parent so only the guard (not missing-file) fires
    writeFileSync(join(dirname(dir), 'evil.json'), JSON.stringify(board('evil')));
    try {
      await expectError(dir, 'schema_violation', /escapes the template directory/);
    } finally {
      rmSync(join(dirname(dir), 'evil.json'), { force: true });
    }
  });

  it('manifest absolute board path → rejected', async () => {
    write(
      'substrate-template.json',
      JSON.stringify({ name: 'X', description: 'd', version: '1', boards: ['/etc/passwd'] }),
    );
    await expectError(dir, 'schema_violation', /relative path/);
  });

  // --- convention mode ---
  it('convention: .substrate/boards/ is preferred over boards/', async () => {
    writeBoard('.substrate/boards/a.json', 'pref');
    writeBoard('boards/b.json', 'other');
    const r = await loadExternalTemplate(dir);
    expect(r.source).toBe('convention');
    expect(r.boards.map((b) => b.id)).toEqual(['pref']); // no union
  });

  it('convention: boards/-only works', async () => {
    writeBoard('boards/a.json', 'a');
    writeBoard('boards/b.json', 'b');
    const r = await loadExternalTemplate(dir);
    expect(r.boards.map((b) => b.id).sort()).toEqual(['a', 'b']); // sorted load
  });

  it('absent manifest + no boards → not_found "Is this a substrate template?"', async () => {
    mkdirSync(join(dir, 'empty'), { recursive: true });
    await expectError(dir, 'not_found', /Is this a substrate template/);
  });

  // --- validation depth ---
  it('a board failing BoardSchema fails the load naming the file', async () => {
    write('boards/bad.json', JSON.stringify({ id: 'bad', name: 'no required fields' }));
    await expectError(dir, 'schema_violation', /bad\.json/);
  });

  it('cross-file duplicate board id names BOTH files (convention)', async () => {
    writeBoard('boards/one.json', 'dup');
    writeBoard('boards/two.json', 'dup');
    await expectError(dir, 'schema_violation', /one\.json.*two\.json|two\.json.*one\.json/);
  });

  it('cross-file duplicate board id names BOTH files (manifest)', async () => {
    writeBoard('boards/one.json', 'dup');
    writeBoard('boards/two.json', 'dup');
    write(
      'substrate-template.json',
      JSON.stringify({
        name: 'X',
        description: 'd',
        version: '1',
        boards: ['boards/one.json', 'boards/two.json'],
      }),
    );
    await expectError(dir, 'schema_violation', /Duplicate board id 'dup'/);
  });

  // --- arg-shape rejections ---
  it('a URL-shaped arg is rejected (clone first)', async () => {
    await expectError(
      'https://github.com/x/y',
      'schema_violation',
      /does not fetch over the network/,
    );
    await expectError(
      'git@github.com:x/y.git',
      'schema_violation',
      /does not fetch over the network/,
    );
  });

  it('a path that does not exist → not_found', async () => {
    await expectError(join(dir, 'nope'), 'not_found', /No such path/);
  });

  it('a bare board .json file arg → the O3 "that\'s a board file" error', async () => {
    const bf = write('boards/delivery.json', JSON.stringify(board('delivery')));
    await expectError(bf, 'schema_violation', /board file, not a template/);
  });
});
