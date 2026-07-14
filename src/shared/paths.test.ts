import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { paths, substrateRootFromCwd } from './paths.js';

describe('paths', () => {
  const root = '/tmp/test-substrate/.substrate';
  const p = paths(root);

  it('exposes the root unchanged', () => {
    expect(p.root).toBe(root);
  });

  it('builds config.json path', () => {
    expect(p.config).toBe(join(root, 'config.json'));
  });

  it('builds data.sqlite path + wal/shm siblings', () => {
    expect(p.dataSqlite).toBe(join(root, 'data.sqlite'));
    expect(p.dataSqliteWal).toBe(join(root, 'data.sqlite-wal'));
    expect(p.dataSqliteShm).toBe(join(root, 'data.sqlite-shm'));
  });

  it('builds substrate.pid path', () => {
    expect(p.pid).toBe(join(root, 'substrate.pid'));
  });

  it('builds serve.json runtime-record path', () => {
    expect(p.serveRuntime).toBe(join(root, 'serve.json'));
  });

  it('builds boards/ + attachments/ paths', () => {
    expect(p.boardsDir).toBe(join(root, 'boards'));
    expect(p.attachmentsDir).toBe(join(root, 'attachments'));
  });

  it('builds boardJson(id) and attachmentTaskDir(id)', () => {
    expect(p.boardJson('abc-123')).toBe(join(root, 'boards', 'abc-123.json'));
    expect(p.attachmentTaskDir('task-1')).toBe(join(root, 'attachments', 'task-1'));
  });

  it('does not allow path traversal in board IDs (caller responsibility)', () => {
    // paths() is dumb — it just joins. Callers must validate IDs upstream.
    // This test documents the contract: paths() does NOT canonicalize.
    expect(p.boardJson('../escape')).toBe(join(root, 'boards', '../escape.json'));
  });
});

describe('substrateRootFromCwd', () => {
  it('joins cwd with .substrate/', () => {
    // Use join() for the expectation so this holds on Windows (\\) too.
    expect(substrateRootFromCwd('/some/cwd')).toBe(join('/some/cwd', '.substrate'));
  });
});
