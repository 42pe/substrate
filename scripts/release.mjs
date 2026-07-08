#!/usr/bin/env node
/**
 * Cut a Substrate release: bump the version in all three sources of truth,
 * rotate the CHANGELOG, and (optionally) commit + tag. Run it ON `dev` (where
 * feature work integrates), then fast-forward `main` to the tagged commit — see
 * RELEASING.md. `main` only advances on a release.
 *
 *   node scripts/release.mjs <version>     # e.g. 0.7.0
 *   node scripts/release.mjs minor|patch|major
 *   node scripts/release.mjs <bump> --tag  # also git commit + tag vX.Y.Z
 *   node scripts/release.mjs <bump> --skip-validate   # skip build/tsc/lint/test
 *
 * Version is kept in lockstep across: package.json, ui/package.json, and
 * src/core/version.ts (BINARY_VERSION — read by the MCP server name + /api/health).
 * The CHANGELOG's `## [Unreleased]` block is renamed to `## [x.y.z] - YYYY-MM-DD`
 * and a fresh empty `## [Unreleased]` is inserted above it.
 *
 * Without `--tag` it only edits files and prints the git commands to run — so you
 * can eyeball the diff first. This is the whole ritual; see RELEASING.md.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname;
const args = process.argv.slice(2);
const doTag = args.includes('--tag');
const skipValidate = args.includes('--skip-validate');
const target = args.find((a) => !a.startsWith('--'));
if (!target)
  fail('Usage: node scripts/release.mjs <version|minor|patch|major> [--tag] [--skip-validate]');

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}
function read(p) {
  return readFileSync(new URL(p, `file://${ROOT}`), 'utf8');
}
function write(p, s) {
  writeFileSync(new URL(p, `file://${ROOT}`), s);
}

const currentPkg = JSON.parse(read('package.json'));
const current = currentPkg.version;

function nextVersion(cur, spec) {
  if (/^\d+\.\d+\.\d+$/.test(spec)) return spec;
  const [maj, min, pat] = cur.split('.').map(Number);
  if (spec === 'major') return `${maj + 1}.0.0`;
  if (spec === 'minor') return `${maj}.${min + 1}.0`;
  if (spec === 'patch') return `${maj}.${min}.${pat + 1}`;
  fail(`Unrecognized version spec '${spec}' (use x.y.z, or major|minor|patch)`);
}

const version = nextVersion(current, target);
const tag = `v${version}`;

// Refuse a no-op / downgrade before touching any file (avoids partial edits on an
// idempotent re-run — e.g. running the preview twice — or a typo'd lower version).
if (version === current) fail(`Already at ${version} — nothing to release.`);
const [na, nb, nc] = version.split('.').map(Number);
const [ca, cb, cc] = current.split('.').map(Number);
const isDowngrade = na < ca || (na === ca && (nb < cb || (nb === cb && nc < cc)));
if (isDowngrade)
  fail(`Target ${version} is lower than current ${current} — refusing to downgrade.`);

// Guard: clean working tree (the release commit should be just the bump).
const dirty = execSync('git status --porcelain', { cwd: ROOT }).toString().trim();
if (dirty && doTag)
  fail('Working tree is dirty — commit or stash first (or drop --tag to only edit files).');
const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT }).toString().trim();
if (branch !== 'dev' && branch !== 'main')
  console.warn(
    `⚠ On branch '${branch}', not 'dev'/'main'. Releases are cut on 'dev', then promoted to 'main' (see RELEASING.md).`,
  );

console.log(`Releasing ${current} → ${version}${doTag ? ' (will commit + tag)' : ''}`);

if (!skipValidate) {
  console.log('Validating (build + tsc + lint + format + test)…');
  for (const cmd of [
    'pnpm build',
    'pnpm exec tsc -p tsconfig.build.json --noEmit',
    'pnpm lint',
    'pnpm format:check',
    'pnpm test',
  ]) {
    console.log(`  $ ${cmd}`);
    execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
  }
}

// 1. Bump the three version sites.
const pkg = JSON.parse(read('package.json'));
pkg.version = version;
write('package.json', JSON.stringify(pkg, null, 2) + '\n');

const uiPkg = JSON.parse(read('ui/package.json'));
uiPkg.version = version;
write('ui/package.json', JSON.stringify(uiPkg, null, 2) + '\n');

const verFile = read('src/core/version.ts');
const bumped = verFile.replace(
  /export const BINARY_VERSION = '[^']*';/,
  `export const BINARY_VERSION = '${version}';`,
);
if (bumped === verFile) fail('Could not find BINARY_VERSION in src/core/version.ts');
write('src/core/version.ts', bumped);

// 2. Rotate the CHANGELOG: [Unreleased] → [x.y.z] - date, fresh [Unreleased] above.
const today = new Date().toISOString().slice(0, 10);
const changelog = read('CHANGELOG.md');
if (!/##\s*\[Unreleased\]/.test(changelog)) fail('CHANGELOG.md has no ## [Unreleased] section.');
const rotated = changelog.replace(
  /##\s*\[Unreleased\]\s*\n(\s*\n)?(_Nothing yet\._\s*\n\s*\n)?/,
  `## [Unreleased]\n\n_Nothing yet._\n\n## [${version}] - ${today}\n\n`,
);
if (rotated === changelog)
  fail('CHANGELOG rotation matched nothing — is the [Unreleased] heading well-formed?');
write('CHANGELOG.md', rotated);

console.log(
  `✓ Bumped package.json, ui/package.json, src/core/version.ts, and CHANGELOG.md → ${version}`,
);

if (doTag) {
  execSync('git add package.json ui/package.json src/core/version.ts CHANGELOG.md', { cwd: ROOT });
  execSync(`git commit -m "chore(release): ${version}"`, { cwd: ROOT, stdio: 'inherit' });
  execSync(`git tag ${tag}`, { cwd: ROOT });
  console.log(`✓ Committed and tagged ${tag}. Push with:  git push && git push origin ${tag}`);
} else {
  console.log('\nReview the diff, then:');
  console.log(`  git add package.json ui/package.json src/core/version.ts CHANGELOG.md`);
  console.log(`  git commit -m "chore(release): ${version}"`);
  console.log(`  git tag ${tag} && git push && git push origin ${tag}`);
}
