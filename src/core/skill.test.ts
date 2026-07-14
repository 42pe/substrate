import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  packagedSkillDir,
  compareSkill,
  syncSkill,
  readInstalledStamp,
  SKILL_STAMP_FILE,
} from './skill.js';
import { BINARY_VERSION } from './version.js';

describe('packagedSkillDir', () => {
  it('resolves to a real dir containing SKILL.md (guards the build layout)', () => {
    const dir = packagedSkillDir();
    expect(existsSync(join(dir, 'SKILL.md'))).toBe(true);
  });
});

describe('packaging', () => {
  it('ships skills/ in the npm files allowlist (so the skill travels post-npm)', () => {
    // src/core/skill.test.ts → repo root is two levels up.
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8')) as {
      files: string[];
    };
    expect(pkg.files).toContain('skills');
  });
});

describe('compareSkill / syncSkill', () => {
  let root: string;
  let packagedDir: string;
  let targetDir: string;

  function stamp(dir: string): string | null {
    return readInstalledStamp(dir);
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'substrate-skill-'));
    packagedDir = join(root, 'packaged');
    targetDir = join(root, 'installed');
    mkdirSync(packagedDir, { recursive: true });
    writeFileSync(join(packagedDir, 'SKILL.md'), '# Substrate skill\nbody\n');
    writeFileSync(join(packagedDir, 'AUTHORING.md'), 'authoring notes\n');
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('reports missing when the target is absent', () => {
    const cmp = compareSkill({ packagedDir, targetDir });
    expect(cmp.state).toBe('missing');
    expect(cmp.installed).toBeNull();
    expect(cmp.expected).toBe(BINARY_VERSION);
  });

  it('reports drift (unstamped) when SKILL.md exists but no stamp', () => {
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, 'SKILL.md'), '# Substrate skill\nbody\n');
    const cmp = compareSkill({ packagedDir, targetDir });
    expect(cmp.state).toBe('drift');
    expect(cmp.installed).toBeNull();
    expect(cmp.reason).toMatch(/unstamped/);
  });

  it('reports drift (wrong version) when stamped at a different version', () => {
    syncSkill({ packagedDir, targetDir });
    writeFileSync(join(targetDir, SKILL_STAMP_FILE), '9.9.9\n');
    const cmp = compareSkill({ packagedDir, targetDir });
    expect(cmp.state).toBe('drift');
    expect(cmp.installed).toBe('9.9.9');
    expect(cmp.reason).toContain(BINARY_VERSION);
  });

  it('reports drift (content) when stamped current but a file differs', () => {
    syncSkill({ packagedDir, targetDir });
    writeFileSync(join(targetDir, 'SKILL.md'), '# tampered\n');
    const cmp = compareSkill({ packagedDir, targetDir });
    expect(cmp.state).toBe('drift');
    expect(cmp.installed).toBe(BINARY_VERSION);
    expect(cmp.reason).toMatch(/content differs/);
  });

  it('reports ok when stamped current and content matches', () => {
    syncSkill({ packagedDir, targetDir });
    const cmp = compareSkill({ packagedDir, targetDir });
    expect(cmp.state).toBe('ok');
    expect(cmp.installed).toBe(BINARY_VERSION);
  });

  it('syncSkill copies byte-identical files and stamps the version', () => {
    const res = syncSkill({ packagedDir, targetDir });
    expect(res.changed).toBe(true);
    expect(res.version).toBe(BINARY_VERSION);
    expect(readFileSync(join(targetDir, 'SKILL.md'))).toEqual(
      readFileSync(join(packagedDir, 'SKILL.md')),
    );
    expect(readFileSync(join(targetDir, 'AUTHORING.md'))).toEqual(
      readFileSync(join(packagedDir, 'AUTHORING.md')),
    );
    expect(stamp(targetDir)).toBe(BINARY_VERSION);
  });

  it('syncSkill is idempotent — a second run is a no-op', () => {
    expect(syncSkill({ packagedDir, targetDir }).changed).toBe(true);
    expect(syncSkill({ packagedDir, targetDir }).changed).toBe(false);
  });

  it('syncSkill repairs a stale stamp + resyncs content', () => {
    syncSkill({ packagedDir, targetDir });
    writeFileSync(join(targetDir, SKILL_STAMP_FILE), '0.0.1\n');
    writeFileSync(join(targetDir, 'SKILL.md'), '# stale\n');
    const res = syncSkill({ packagedDir, targetDir });
    expect(res.changed).toBe(true);
    expect(stamp(targetDir)).toBe(BINARY_VERSION);
    expect(readFileSync(join(targetDir, 'SKILL.md'))).toEqual(
      readFileSync(join(packagedDir, 'SKILL.md')),
    );
  });
});
