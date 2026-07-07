import { describe, it, expect, vi, afterEach } from 'vitest';
import { rmrfSync } from '../../tests/helpers/tmp.js';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logger } from './logger.js';
import { paths } from './paths.js';
import { warnIfFreshDbWithBoards } from './startup-checks.js';

describe('warnIfFreshDbWithBoards (B7)', () => {
  const dirs: string[] = [];
  function tempRoot(withBoard: boolean): string {
    const dir = mkdtempSync(join(tmpdir(), 'substrate-sc-'));
    dirs.push(dir);
    const root = join(dir, '.substrate');
    mkdirSync(paths(root).boardsDir, { recursive: true });
    if (withBoard) writeFileSync(paths(root).boardJson('b'), '{}');
    return root;
  }

  afterEach(() => {
    vi.restoreAllMocks();
    for (const d of dirs.splice(0)) rmrfSync(d);
  });

  it('warns when boards exist but the db was just created (fresh worktree/clone)', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    warnIfFreshDbWithBoards(tempRoot(true), false);
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/not shared/i);
  });

  it('does not warn when the db already existed (normal case)', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    warnIfFreshDbWithBoards(tempRoot(true), true);
    expect(warn).not.toHaveBeenCalled();
  });

  it('does not warn on a genuine first init (no board files yet)', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    warnIfFreshDbWithBoards(tempRoot(false), false);
    expect(warn).not.toHaveBeenCalled();
  });
});
