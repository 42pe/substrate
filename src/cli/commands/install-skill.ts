import { compareSkill, syncSkill, installedSkillDir } from '../../core/skill.js';

/**
 * `substrate install-skill` — copy the packaged agent skill into
 * `~/.claude/skills/substrate`, stamped with this binary's version, so the
 * installed skill can't silently drift from the binary. Idempotent: re-running
 * a current install is a no-op that reports "already current".
 *
 * `--check` reports drift and exits non-zero WITHOUT writing anything (for CI /
 * diagnose): exit 0 only when the installed stamp matches BINARY_VERSION and the
 * content matches; non-zero when the skill is missing or stamped/authored
 * differently.
 *
 * `targetDir` / `packagedDir` are injectable for tests; production uses the real
 * install path and the skill packaged inside this binary.
 */
export async function installSkillCommand(
  opts: { check?: boolean; targetDir?: string; packagedDir?: string } = {},
): Promise<void> {
  const { check, targetDir, packagedDir } = opts;
  const write = (s: string): void => {
    process.stdout.write(s);
  };
  // Forward only the dirs that were actually supplied (exactOptionalPropertyTypes).
  const dirs = {
    ...(targetDir !== undefined ? { targetDir } : {}),
    ...(packagedDir !== undefined ? { packagedDir } : {}),
  };

  if (check) {
    const cmp = compareSkill(dirs);
    const where = targetDir ?? installedSkillDir();
    if (cmp.state === 'ok') {
      write(`✓ installed skill is in sync (v${cmp.expected}) at ${where}\n`);
      return;
    }
    const detail = cmp.state === 'missing' ? 'not installed' : `drift — ${cmp.reason}`;
    write(`✗ installed skill ${detail} at ${where}\n  Run 'substrate install-skill' to fix.\n`);
    process.exitCode = 1;
    return;
  }

  const res = syncSkill(dirs);
  write(
    res.changed
      ? `Installed/updated the substrate skill to v${res.version} at ${res.targetDir}\n`
      : `Already current (v${res.version}) at ${res.targetDir}\n`,
  );
}
