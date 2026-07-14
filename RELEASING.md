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
branches. CI is billing-blocked, so everything runs locally.

```sh
git checkout dev && git pull

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
only if you've just validated by hand. Tags are `vX.Y.Z` (distinct from the historical
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
