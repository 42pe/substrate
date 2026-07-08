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

## Cutting a release

Releases are cut **on `main`, after the release's features have merged** (CI is
billing-blocked, so this runs locally). The release commit is mechanical — just
the version bump + changelog rotation — so it doesn't need its own review.

```sh
git checkout main && git pull

# Preview: bump the three version sites + rotate the CHANGELOG, print git steps.
pnpm release minor            # or: patch | major | an explicit 0.7.0

# Eyeball the diff, then commit + tag in one shot (re-runs validation):
pnpm release minor --tag
git push && git push origin vX.Y.Z
```

`pnpm release <spec>` validates (build + tsc + lint + format + test), bumps the
three version files, renames `## [Unreleased]` → `## [x.y.z] - <today>`, and
inserts a fresh empty `## [Unreleased]`. Add `--tag` to also `git commit` +
`git tag vX.Y.Z`; add `--skip-validate` only if you've just validated by hand.

Tags are `vX.Y.Z` (distinct from the historical `phase-NN-complete` dev-milestone
tags). After tagging, reinstall the global copy so day-to-day work uses the
release (see below).

## After a release — refresh the globally-installed copy

The `substrate` binary used to drive real projects (and Substrate's own dogfood
board) is a global install, deliberately separate from this dev checkout so
operating a board never breaks mid-edit. Refresh it from the tagged `main`:

```sh
export PNPM_HOME="$HOME/Library/pnpm" && export PATH="$PNPM_HOME:$PATH"
pnpm build
pnpm add -g "$PWD/$(pnpm pack | tail -1)"   # the "no binaries" warning is benign
```

## Publishing to npm (not yet)

Substrate isn't on npm yet. When it ships, `npm publish` (respecting the `files`
allowlist: `dist`, `README.md`, `LICENSE`, `CHANGELOG.md`) becomes the final step
after tagging, and the `npx @diegoferreyra/substrate` paths in the docs start
resolving.
