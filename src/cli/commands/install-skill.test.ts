import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installSkillCommand } from './install-skill.js';
import { SKILL_STAMP_FILE } from '../../core/skill.js';
import { BINARY_VERSION } from '../../core/version.js';

describe('installSkillCommand', () => {
  let root: string;
  let packagedDir: string;
  let targetDir: string;
  let out: string[];
  let savedExitCode: typeof process.exitCode;

  function output(): string {
    return out.join('');
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'substrate-installskill-'));
    packagedDir = join(root, 'packaged');
    targetDir = join(root, 'installed');
    mkdirSync(packagedDir, { recursive: true });
    writeFileSync(join(packagedDir, 'SKILL.md'), '# Substrate skill\nbody\n');
    savedExitCode = process.exitCode;
    process.exitCode = undefined;
    out = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => {
      out.push(String(s));
      return true;
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = savedExitCode;
    rmSync(root, { recursive: true, force: true });
  });

  it('installs into an absent target, stamps the version', async () => {
    await installSkillCommand({ targetDir, packagedDir });
    expect(existsSync(join(targetDir, 'SKILL.md'))).toBe(true);
    expect(existsSync(join(targetDir, SKILL_STAMP_FILE))).toBe(true);
    expect(output()).toMatch(/Installed\/updated the substrate skill to v/);
  });

  it('is idempotent — a second run reports "already current" and does not error', async () => {
    await installSkillCommand({ targetDir, packagedDir });
    out = [];
    await installSkillCommand({ targetDir, packagedDir });
    expect(output()).toMatch(/Already current/);
    expect(process.exitCode).not.toBe(1);
  });

  it('--check exits 0 and writes nothing when in sync', async () => {
    await installSkillCommand({ targetDir, packagedDir });
    out = [];
    await installSkillCommand({ check: true, targetDir, packagedDir });
    expect(output()).toMatch(/in sync/);
    expect(process.exitCode).not.toBe(1);
  });

  it('--check exits non-zero for a missing skill and does not write', async () => {
    await installSkillCommand({ check: true, targetDir, packagedDir });
    expect(process.exitCode).toBe(1);
    expect(output()).toMatch(/not installed/);
    expect(existsSync(targetDir)).toBe(false); // did NOT write
  });

  it('--check exits non-zero for a drifted (wrong-version) skill and does not write', async () => {
    await installSkillCommand({ targetDir, packagedDir });
    writeFileSync(join(targetDir, SKILL_STAMP_FILE), '9.9.9\n');
    out = [];
    await installSkillCommand({ check: true, targetDir, packagedDir });
    expect(process.exitCode).toBe(1);
    expect(output()).toMatch(/drift/);
    // --check must not repair: the stale stamp is still there.
    const stamp = (await import('node:fs')).readFileSync(
      join(targetDir, SKILL_STAMP_FILE),
      'utf-8',
    );
    expect(stamp.trim()).toBe('9.9.9');
  });

  it('repairs a drifted skill on a normal (non-check) run', async () => {
    await installSkillCommand({ targetDir, packagedDir });
    writeFileSync(join(targetDir, SKILL_STAMP_FILE), '9.9.9\n');
    out = [];
    await installSkillCommand({ targetDir, packagedDir });
    expect(output()).toMatch(new RegExp(`to v${BINARY_VERSION.replace('.', '\\.')}`));
  });
});
