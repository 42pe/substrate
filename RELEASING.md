# Releasing Substrate

Substrate follows [Semantic Versioning](https://semver.org/) and
[Keep a Changelog](https://keepachangelog.com/). While on `0.x`, the API is not
yet frozen: **minor** = new features (and any breaking change), **patch** = fixes.

## Version lives in three places (kept in lockstep)

- `package.json` — the published package version.
- `ui/package.json` — the bundled UI (same version).
- `src/core/version.ts` — `BINARY_VERSION`, read by the MCP server's `name/version`
  and the HTTP `/api/health` endpoint. A test asserts `whoami` reports it, so it
  can't silently drift.

The release script bumps all three.

## During normal development

Every PR that makes a user- or agent-visible change adds a bullet under the
**`## [Unreleased]`** heading in `CHANGELOG.md` (in `Added` / `Changed` /
`Fixed` / `Removed`). Keep entries user-facing — what changed and why it matters,
not the internal mechanics.

## Branching model

Feature work merges to **`dev`**; **`main` only advances on a release.** A release
promotes `dev` → `main` plus a `vX.Y.Z` tag. `main` therefore always sits at the
last released version. This flow is tracked on the **`release`** board in
`.substrate/`.

## Cutting a release

Cut the release **on `dev`** (the version-bump + changelog-rotation is a mechanical
commit, so it doesn't need its own review), then fast-forward `main` to it. Because
the merge is a fast-forward, the tag lands on the one commit that is the tip of both
branches. Validate **both** locally and in CI: the local gate must match what CI runs
(crucially `tsc --noEmit` on root + ui, which typecheck the test files `pnpm build`
skips), **and** GitHub Actions CI must be green on the `dev` commit you're about to tag.
Don't tag a commit whose CI hasn't gone green — that's the mistake this guards against.

**Before any of this, verify docs aren't stale for the features being launched.** List
what's shipping — `git log <last-tag>..dev --oneline` — and for each launched feature
confirm it has a CHANGELOG `[Unreleased]` entry and that any tool/command/flag/API/error
code it touched is reflected in README, SKILL.md, AUTHORING.md, and prd.md. This is the
release board's **Docs Verified** gate (it enumerates the checklist per feature); an
independent audit agent is ideal. v0.7.0 shipped with 6 of 7 features missing their
changelog line — this step exists to catch exactly that.

```sh
git checkout dev && git pull

# 0. Confirm CI is GREEN on the dev commit you're releasing (not just local):
gh run list --branch dev --workflow CI --limit 1   # latest must be completed / success
#    If it's red, fix on dev and re-push until green BEFORE cutting the tag.

# 1. Bump the three version sites + rotate the CHANGELOG, then commit + tag.
#    Pick ONE — don't combine them (the preview leaves a dirty tree the --tag run refuses):
pnpm release minor --tag      # one shot from a clean tree: validate, bump, commit, tag  (Option A)
#   — or —
pnpm release minor            # preview: edits the 4 files, prints the git commands       (Option B)
#   …review `git diff`, then run the printed git add / commit / tag lines.

git push origin dev && git push origin vX.Y.Z

# 2. Promote dev → main (fast-forward; the tag already points at this commit).
git checkout main && git pull && git merge --ff-only dev && git push origin main
git checkout dev              # back to the integration branch
```

`pnpm release <spec>` validates (build + tsc + lint + format + test), bumps the
three version files, renames `## [Unreleased]` → `## [x.y.z] - <today>`, and
inserts a fresh empty `## [Unreleased]`. Without `--tag` it stops there and prints
the git steps; `--tag` also commits + tags (from a clean tree). Add `--skip-validate`
only if you've just validated by hand. **Note:** that built-in validate does *not*
yet run `tsc --noEmit` (root + ui), the ui test suite, or the smoke tests — so it can
pass while CI fails on a test-file type error. Until the script is hardened, run the
CI-parity checks yourself (`pnpm exec tsc --noEmit`, `pnpm --dir ui exec tsc --noEmit`,
`pnpm --dir ui test`, `pnpm test:smoke:concurrency`) and the step-0 CI check above. Tags are `vX.Y.Z` (distinct from the historical
`phase-NN-complete` dev-milestone tags). After tagging, reinstall the global copy so
day-to-day work uses the release (see below).

## After a release — refresh the globally-installed copy

The `substrate` binary used to drive real projects (and Substrate's own dogfood
board) is a global install, deliberately separate from this dev checkout so
operating a board never breaks mid-edit. Refresh it from the tagged `main`:

```sh
export PNPM_HOME="$HOME/Library/pnpm" && export PATH="$PNPM_HOME:$PATH"
pnpm build
pnpm add -g "$PWD/$(pnpm pack | tail -1)"   # the "no binaries" warning is benign
substrate install-skill                     # refresh ~/.claude/skills/substrate from the new binary
substrate diagnose                          # confirm the "Skill:" line reads "in sync"
```

The `substrate install-skill` step keeps the globally-installed agent skill in
lockstep with the binary — it copies the skill packaged inside the release and
stamps it with the new `BINARY_VERSION`. Skipping it leaves agents reading a
stale skill; `substrate diagnose` (and `substrate install-skill --check`) will
flag the drift.

## Publishing to npm (not yet)

Substrate isn't on npm yet. When it ships, `npm publish` (respecting the `files`
allowlist: `dist`, `skills`, `README.md`, `LICENSE`, `CHANGELOG.md`) becomes the
final step after tagging, and the `npx @diegoferreyra/substrate` paths in the
docs start resolving. `skills/` ships in the tarball so `substrate install-skill`
has a source of truth after an npm install (no repo checkout needed).
