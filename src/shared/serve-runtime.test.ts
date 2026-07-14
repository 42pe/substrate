import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readServeRuntime,
  writeServeRuntime,
  clearServeRuntime,
  clearServeRuntimeSync,
  type ServeRuntime,
} from './serve-runtime.js';

describe('serve-runtime', () => {
  let dir: string;
  let file: string;
  const rec: ServeRuntime = { pid: 4321, port: 7477, started_at: '2026-07-13T00:00:00.000Z' };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'substrate-runtime-'));
    file = join(dir, 'serve.json');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips a written record', async () => {
    await writeServeRuntime(file, rec);
    expect(await readServeRuntime(file)).toEqual(rec);
  });

  it('returns null when the file is absent', async () => {
    expect(await readServeRuntime(join(dir, 'nope.json'))).toBeNull();
  });

  it('returns null on malformed JSON', async () => {
    writeFileSync(file, '{ not json');
    expect(await readServeRuntime(file)).toBeNull();
  });

  it('returns null on a wrong-shaped record', async () => {
    writeFileSync(file, JSON.stringify({ pid: 'x', port: 1 }));
    expect(await readServeRuntime(file)).toBeNull();
  });

  it('clearServeRuntime removes the file and never throws when absent', async () => {
    await writeServeRuntime(file, rec);
    await clearServeRuntime(file);
    expect(existsSync(file)).toBe(false);
    await clearServeRuntime(file); // idempotent — no throw
  });

  it('clearServeRuntimeSync removes the file', async () => {
    await writeServeRuntime(file, rec);
    clearServeRuntimeSync(file);
    expect(existsSync(file)).toBe(false);
    clearServeRuntimeSync(file); // idempotent — no throw
  });
});
