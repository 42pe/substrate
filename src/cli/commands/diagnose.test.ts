import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { rmrfSync } from '../../../tests/helpers/tmp.js';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initCommand } from './init.js';
import { diagnoseCommand } from './diagnose.js';
import { paths, substrateRootFromCwd } from '../../shared/paths.js';
import { syncSkill, installedSkillDir, SKILL_STAMP_FILE } from '../../core/skill.js';

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
    rmrfSync(cwd);
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

describe('diagnoseCommand — server section', () => {
  let cwd: string;
  let out: string[];
  let savedExitCode: typeof process.exitCode;

  function output(): string {
    return out.join('');
  }
  function writeRuntime(record: object): void {
    const root = substrateRootFromCwd(cwd);
    writeFileSync(paths(root).serveRuntime, JSON.stringify(record));
  }

  beforeEach(async () => {
    cwd = mkdtempSync(join(tmpdir(), 'substrate-diag-srv-'));
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
    rmrfSync(cwd);
  });

  it('reports the served port from a live runtime record', async () => {
    writeRuntime({ pid: process.pid, port: 7488, started_at: '2026-07-13T00:00:00.000Z' });
    await diagnoseCommand(cwd);
    expect(output()).toContain('serving on port 7488');
    expect(output()).toContain(`pid ${process.pid}`);
    expect(process.exitCode).not.toBe(1);
  });

  it('ignores a stale runtime record (dead pid) and probes instead', async () => {
    writeRuntime({ pid: 2_147_483_646, port: 7488, started_at: '2026-07-13T00:00:00.000Z' });
    await diagnoseCommand(cwd);
    const o = output();
    expect(o).toContain('stale runtime record');
    expect(o).not.toContain('serving on port 7488');
  });

  it('probes the range when there is no runtime record', async () => {
    await diagnoseCommand(cwd);
    // Either the range is clear or some slot is in use — both are non-error info.
    expect(output()).toMatch(/no server running here|ports in use in range/);
  });
});

describe('diagnoseCommand — skill section', () => {
  let cwd: string;
  let home: string;
  let out: string[];
  let savedExitCode: typeof process.exitCode;
  let savedHome: string | undefined;

  function output(): string {
    return out.join('');
  }

  beforeEach(async () => {
    cwd = mkdtempSync(join(tmpdir(), 'substrate-diag-skill-'));
    // Isolate the installed-skill probe onto a throwaway HOME so the test is
    // deterministic regardless of the developer's real ~/.claude/skills.
    home = mkdtempSync(join(tmpdir(), 'substrate-home-'));
    savedHome = process.env['HOME'];
    process.env['HOME'] = home;
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
    if (savedHome === undefined) delete process.env['HOME'];
    else process.env['HOME'] = savedHome;
    rmrfSync(cwd);
    rmSync(home, { recursive: true, force: true });
  });

  it('reports the installed skill in sync after install-skill', async () => {
    syncSkill(); // installs the packaged skill into the temp HOME + stamps it
    await diagnoseCommand(cwd);
    expect(output()).toMatch(/installed skill.*in sync/);
    expect(process.exitCode).not.toBe(1);
  });

  it('flags a version-drifted skill as a hard problem (exit 1)', async () => {
    syncSkill();
    writeFileSync(join(installedSkillDir(), SKILL_STAMP_FILE), '9.9.9\n');
    await diagnoseCommand(cwd);
    expect(output()).toMatch(/installed skill.*drift/);
    expect(process.exitCode).toBe(1);
  });

  it('treats a not-installed skill as advisory (no exit flip)', async () => {
    await diagnoseCommand(cwd); // temp HOME has no skill installed
    expect(output()).toMatch(/installed skill.*not installed/);
    expect(process.exitCode).not.toBe(1);
  });
});
