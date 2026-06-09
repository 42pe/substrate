import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initCommand } from './init.js';
import { diagnoseCommand } from './diagnose.js';
import { paths, substrateRootFromCwd } from '../../shared/paths.js';

describe('diagnoseCommand — recent errors section', () => {
  let cwd: string;
  let out: string[];
  let savedExitCode: typeof process.exitCode;

  function output(): string {
    return out.join('');
  }
  function seedLog(content: string): void {
    const root = substrateRootFromCwd(cwd);
    mkdirSync(paths(root).logsDir, { recursive: true });
    writeFileSync(paths(root).logFile, content);
  }

  beforeEach(async () => {
    cwd = mkdtemp();
    savedExitCode = process.exitCode;
    process.exitCode = undefined;
    await initCommand(cwd);
    out = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => {
      out.push(String(s));
      return true;
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = savedExitCode;
    rmSync(cwd, { recursive: true, force: true });
  });

  function mkdtemp(): string {
    return mkdtempSync(join(tmpdir(), 'substrate-diag-'));
  }

  it('shows "no recent errors" for a healthy substrate with no log', async () => {
    await diagnoseCommand(cwd);
    expect(output()).toContain('no recent errors');
    expect(output()).not.toContain('Recent errors:');
  });

  it('lists the last 5 ERROR headers (stacks excluded) + a pointer', async () => {
    const events: string[] = [];
    for (let i = 1; i <= 6; i++) {
      events.push(`2026-06-09T10:00:0${i}.000Z ERROR failure number ${i} {"error":"e${i}"}`);
      events.push('    Error: stack', `        at frame${i} (/f.js:${i}:1)`);
    }
    seedLog(`${events.join('\n')}\n`);

    await diagnoseCommand(cwd);
    const o = output();
    expect(o).toContain('Recent errors:');
    // last 5 shown; the oldest (failure number 1) is dropped
    expect(o).toContain('failure number 6');
    expect(o).toContain('failure number 2');
    expect(o).not.toContain('failure number 1');
    // stacks excluded from the diagnose dump
    expect(o).not.toContain('at frame6');
    expect(o).toContain("run 'substrate logs --errors' for more");
  });

  it('does not change the exit code for historical errors (healthy substrate)', async () => {
    seedLog('2026-06-09T10:00:00.000Z ERROR something failed {"error":"x"}\n');
    await diagnoseCommand(cwd);
    expect(process.exitCode).not.toBe(1); // recent errors are not a current-health problem
  });
});
