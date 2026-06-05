# Phase 6 Plan — OSS Release (artifacts + CI + npm publishing + full `reverse_captcha` → v0.1.0)

**Status:** Reviewed v1.1 (Architect Reviewer APPROVE-WITH-CHANGES; provenance dropped for v0.1.0 per pnpm-7 constraint; CONCERN-1/3/4 + NITs incorporated) — ready for development.
**Author:** Architect
**Last updated:** 2026-06-05
**Spec:** [`specs/phase-06-spec.md`](specs/phase-06-spec.md) (APPROVED 2026-06-05 — B1 + C1–C7 + N1–N5 incorporated)
**Architecture plan:** [`v1-architecture.md`](v1-architecture.md) §5 Phase 6
**Workflow:** [`../workflow.md`](../workflow.md)
**Predecessor:** Phase 5b (`phase-05b-complete`, v0.0.6).
**Feature branch:** `feature/phase-06-oss-release`

---

## 1. Overview

Phase 6 is the FINAL v1 phase: it makes Substrate ship-ready for public release **v0.1.0**. It delivers the OSS root artifacts, a GitHub Actions CI + publish + issue-hygiene pipeline, npm publishing config verified by `--dry-run` + `pack`/`npx` smoke, and replaces the `reverse_captcha` stub with the real two-step timed agent puzzle. Everything lands **in-repo + dry-run-verified**; the live `npm publish`, real tag push, repo creation, and credential/secret setup are **operator tasks Diego performs** (§Operator, spec §6) and are explicitly NOT part of this deliverable.

**No schema change.** `BINARY_SCHEMA_VERSION` stays `2`. `BINARY_VERSION` → `0.1.0` at acceptance.

**5 steps, ONE consolidated Code Reviewer gate (Step 5).** `reverse_captcha` is the only substantive logic; the reviewer also checks the workflows / packaging config / docs in the same pass. Build order front-loads config and docs, then the puzzle, so the reviewer sees the whole diff.

## 2. Branching & merge strategy

- Create `feature/phase-06-oss-release` from `main` (tag `phase-05b-complete`).
- Commit per step. ONE Code Reviewer pass (Step 5).
- Fast-forward merge to `main`, no squash, tag **`phase-06-complete`**.
- **The `v0.1.0` release tag is NOT pushed by the agent** — it is the operator trigger that fires `publish.yml` (§Operator). The agent stops at `phase-06-complete` with everything publish-ready + dry-run-verified.

## 3. Implementation order

### Step 1 — OSS root artifacts (Technical Writer)

Overwrite the existing placeholder root docs and create the net-new community files. (`README.md`, `LICENSE`, `CHANGELOG.md` already exist at the repo root as stubs → **overwrite**. `CONTRIBUTING.md`, `SUPPORT.md`, `examples/README.md`, and the issue templates are **net-new**.)

Create / overwrite (spec §3.1):
- `README.md` (overwrite) — one-paragraph "what it is" (local-first, per-project, agent-collaborative PM substrate via MCP + localhost UI). **3-command quick-start**: `npx @diegoferreyra/substrate init` → `npx @diegoferreyra/substrate serve` (UI on `http://localhost:7475`) → `npx @diegoferreyra/substrate mcp` (plus the `.mcp.json` snippet for Claude Code). Supported-platforms statement: **macOS + Linux primary; Windows + WSL best-effort, CI-visible**. Links to `LICENSE`, `examples/`, `SUPPORT.md`, `CONTRIBUTING.md`.
- `LICENSE` (overwrite) — MIT, `Copyright (c) 2026 Diego Ferreyra`, standard MIT text.
- `CONTRIBUTING.md` (create) — bug-fix PRs **with a repro** welcome; **architecture-changing PRs declined by default** (solo-owned design; open an issue first); how to run the test suite; points to `SUPPORT.md`. **NOT in `files` whitelist** (documents the repo, doesn't ship).
- `SUPPORT.md` (create) — solo project; **weekly triage cadence; no SLAs**; generic **Windows/WSL best-effort** line; where to file (issue templates). **No jsdom/dompurify caveat** (N2: jsdom is a `ui/` test-only devDep, never in the shipped binary). **NOT in `files` whitelist.**
- `CHANGELOG.md` (overwrite) — "Keep a Changelog" style, **starts at `v0.1.0`**; folds Phase 1–5b build-up into one summarized `0.1.0 — initial public release` entry (MCP surface, policy engine, read API, read-only UI, OSS artifacts). Include a short **"npm provenance deferred to v1.x (pinned pnpm 7 lacks `--provenance`; provenance-capable pnpm 9 needs a lockfile-format migration)"** note. The concrete `0.1.0` entry content is finalized in Step 4 alongside the version bump (kept here as the stub heading so the file exists for the `files` whitelist; final dated entry lands at acceptance).
- `examples/README.md` (create) — **`mkdir examples/` first** (the directory does not yet exist), then write the file: placeholder "Real substrates will live here as Diego dogfoods; first one lands in Phase 7." Keeps the README `examples/` link from 404-ing.

_Reviewer focus (Step 5):_ quick-start commands match the real CLI verbs (`init`/`serve`/`mcp`) and the `@diegoferreyra/substrate` package name + port `7475`; `CONTRIBUTING.md`/`SUPPORT.md` are NOT in `files`; no jsdom caveat in `SUPPORT.md`.

Commit: `docs(oss): README, LICENSE, CONTRIBUTING, SUPPORT, CHANGELOG, examples placeholder (Step 1)`.

### Step 2 — GitHub Actions workflows + issue templates (DevOps Engineer)

Create the `.github/` tree (spec §3.2). **pnpm pin (C1):** add `"packageManager": "pnpm@7.18.2"` to `package.json` (the installed dev version, confirmed via `pnpm --version`) so `pnpm/action-setup` is unambiguous; both `ci.yml` and `publish.yml` use `pnpm/action-setup` reading that pin. **Lockfile note (CONCERN-3):** adding `packageManager` does NOT change dependencies, so `pnpm-lock.yaml` is unchanged and **no `pnpm install` is needed** — preempts a "why no lockfile diff?" review question. CI uses `--frozen-lockfile`, which still passes.

Create:
- `.github/workflows/ci.yml` — on push + PR:
  - `strategy.matrix.os: [ubuntu-latest, macos-latest, windows-latest]`, `fail-fast: false`.
  - `continue-on-error: ${{ matrix.os == 'windows-latest' }}` (Windows runs + is visible, never blocks; Ubuntu + macOS blocking).
  - Steps: checkout → `pnpm/action-setup` (version from `packageManager`) → `actions/setup-node` (`node-version: 20`, matches `engines`) → `pnpm install --frozen-lockfile` → then the **cross-platform checks (run on all 3 OSes):** `pnpm build` → `pnpm test` → **`pnpm --dir ui test`** (the dompurify sanitizer + UI component tests — cheap, cross-platform; CONCERN-4/NIT-1: currently silently dropped from CI) → `pnpm lint` → **`pnpm --dir ui lint`** → **`pnpm exec tsc --noEmit`** (root typecheck — distinct from the `pnpm build` typecheck) → `pnpm format:check` → `pnpm test:smoke:concurrency`.
  - **macOS-only additional leg:** `pnpm test:smoke:ui` (Playwright; the script already runs `build:ui` first per 5b C5), gated to `matrix.os == 'macos-latest'`, with the Playwright chromium install/cache on that leg only. This is the **only** macOS-gated check — everything above is cross-platform.
- `.github/workflows/publish.yml` — on tag matching `v*`, single OS (`ubuntu-latest`):
  - `permissions: { contents: read }`. **NO `id-token: write`** — provenance is dropped for v0.1.0 (see below), and `id-token` is only needed for provenance.
  - Steps: checkout → `pnpm/action-setup` → **`actions/setup-node` with `registry-url: 'https://registry.npmjs.org'`** (C2 — kept; npm auth still needs it) → `pnpm install --frozen-lockfile` → **`pnpm build`** (C3 — `dist/` is gitignored; the tarball only exists after build) → `pnpm publish --access public --no-git-checks` with `env: NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` on the publish step. **NO `--provenance`.** The exact pnpm auth wiring (whether pnpm needs `//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}` written into `.npmrc` vs. reading `NODE_AUTH_TOKEN` directly) is **verified in this step** against the pinned `pnpm@7.18.2`; the workflow is written to match what that pnpm actually does. (`NPM_TOKEN` secret itself is operator-configured — §Operator.)
  - **Provenance deferred (resolves C2/CONCERN-2):** empirically confirmed the pinned `pnpm@7.18.2` has **no `--provenance` flag**, and `pnpm-lock.yaml` is lockfileVersion 5.4 (pnpm-7 format). Bumping to a pnpm 9 that supports provenance would force a full lockfile-format migration (5.4 → 9) right before release — too risky. So v0.1.0 ships **without** npm provenance; `packageManager` stays `"pnpm@7.18.2"`. Provenance is deferred to **v1.x**, when the toolchain moves to pnpm 9 (add back `id-token: write` + `--provenance` + `provenance: true` then). Noted in the npm-setup step (Step 3), the CHANGELOG, and §Risks.
- `.github/workflows/auto-close-incomplete-issues.yml` — on `issues: [opened, edited]`:
  - An `actions/github-script` step that greps the **rendered issue BODY for the required-field section HEADINGS** (NOT the form `id:` — issue-forms render each field `label` as a `### ` markdown heading). Missing/blank required section → post a templated comment explaining what's required + **close** with label `incomplete`; reopen path is "edit to add the fields."
  - **Maintainer opt-out:** skip any issue carrying the **`needs-info-exempt`** label.
- `.github/ISSUE_TEMPLATE/bug_report.yml` (create) — GitHub issue **form** with **required** fields whose labels render to the exact headings the workflow greps.
- `.github/ISSUE_TEMPLATE/config.yml` (create) — `blank_issues_enabled: false` (enforces the form).

**Pinned coupling (C7) — the exact rendered headings the form labels and the workflow grep MUST share** (a wording change silently breaks auto-close, so locked here):
  - `### Node version`
  - `### Operating system`
  - `` ### `substrate diagnose` output ``
  - `### Reproduction steps`
Each file (`bug_report.yml` and `auto-close-incomplete-issues.yml`) carries a cross-referencing comment naming the other (`# Headings must match auto-close-incomplete-issues.yml §C7` and vice versa).

_Reviewer focus (Step 5):_ matrix + `fail-fast:false` + Windows `continue-on-error`; CI runs all cross-platform checks (`ui test`/`ui lint`/root `tsc --noEmit` included) on 3 OSes, with `test:smoke:ui` macOS-only; publish job has `registry-url` + `NODE_AUTH_TOKEN` + build-before-publish and **no** `id-token: write` / `--provenance` (deferred to v1.x); the four C7 headings are byte-identical across form and workflow; `needs-info-exempt` opt-out present; `actionlint` (if available) clean.

Commit: `ci(github): CI matrix, npm publish, auto-close issue hygiene + templates (Step 2)`.

### Step 3 — npm publishing setup + dry-run verification (DevOps Engineer)

Modify `package.json` (spec §3.3) — the version bump itself lands in Step 4; this step arms packaging:
- **`files`** — already whitelists `dist`, `README.md`, `LICENSE`, `CHANGELOG.md`. Confirm it produces a clean tarball. `files:["dist"]` ships **all of `dist/**`, including `dist/ui/**`** (the built SPA the `serve` command serves) — **intended and required**. Must NOT ship: `ui/` source, `src/`, `tests/`, `.agents/`, `.substrate/`, dotfiles. There is **no `.npmignore`** so the whitelist alone governs.
- Add **`publishConfig: { "access": "public" }`** ONLY (**NO `provenance: true`**). Provenance is deferred to v1.x — the pinned `pnpm@7.18.2` has no `--provenance` flag, and bumping to provenance-capable pnpm 9 would force a `pnpm-lock.yaml` 5.4 → 9 migration right before release (see Step 2 / §Risks). Add `provenance: true` back when the toolchain moves to pnpm 9.
- **Remove `"private": true`** — this is what *arms* publishing (`pnpm publish` refuses while private). The live publish stays operator-gated, but removal lands in this PR. **Lockfile note (CONCERN-3):** removing `"private": true` does NOT change dependencies, so `pnpm-lock.yaml` is unchanged and **no `pnpm install` is needed** — `--frozen-lockfile` still passes.
- Confirm **`bin: { "substrate": "./dist/server/cli/index.js" }`** resolves to the built CLI and is executable (shebang present after `post-build.mjs` runs).

Verification (run, documented in the step; **build precedes everything — C3**):
1. `pnpm build` (server + ui) — `dist/` is gitignored, a dry-run on a clean tree is meaningless.
2. `pnpm publish --dry-run` — assert the file list is **exactly** `dist/**` (incl. `dist/ui/**`) + `README.md` + `LICENSE` + `CHANGELOG.md` + `package.json`, **no extras**. The whitelist check treats **`dist/ui/**` as EXPECTED-present** (the SPA — not an "extra"); it only flags paths outside `dist/**` + the three root docs + `package.json`. Assert nothing outside the whitelist (no `ui/` source, no `src/`/`tests/`, no `.substrate/`, no dotfiles).
3. `pnpm pack` → `npx ./<tarball> --help` and `npx ./<tarball> init` (in a temp dir) — belt-and-suspenders that the packed CLI runs (R-P1-3).

_Reviewer focus (Step 5):_ `private` removed; `publishConfig` is `{ "access": "public" }` only (no `provenance: true`); `bin` resolves + executable; dry-run file list matches the whitelist exactly with `dist/ui/**` present and no source/tests/`.substrate/` leakage.

Commit: `chore(npm): publishConfig (access public), drop private, verify dry-run + pack smoke (Step 3)`.

### Step 4 — Full `reverse_captcha` + version bump (Backend Engineer)

Replace the stub (`src/mcp/tools/read/reverse-captcha.ts`) with the two-step timed puzzle, and resync the drifted version lockstep. Both land here so the `reverse_captcha` rewrite and the `whoami`/`PHASE_STRING` change ride together and the regression guard is in place before acceptance.

#### 4a — `reverse_captcha` (spec §3.4)

**File layout** — keep it in `src/mcp/tools/read/reverse-captcha.ts` (+ rewritten `.test.ts`). Within that file:
- **Challenge store module** — a module-level `const store = new Map<string, { answer: string; expiresAt: number }>()` scoped to the running MCP process. Export a **`__resetStore()`** test hook (or a factory) so tests start clean. No DB, no file, no timers.
- **TTL/clock seams (N4/N5)** — `const TTL_MS = 10_000`. The handler reads "now" and TTL through **injectable seams**: signature `reverseCaptchaHandler(input, opts?: { now?: () => number; ttlMs?: number })` defaulting to `Date.now` and `TTL_MS`, so the test deterministically produces the **expired** branch without sleeping. `Math.random()`/`Date.now()` are allowed here (runtime source, not a `scripts/*.mjs` workflow — locked decision §3.0.4).

**Protocol (single tool, two call shapes; every payload `isError:false`, uses a `result` discriminant, NEVER `ok` — B1):**
- **Issue** (`challenge_id` + `answer` both absent): `generatePuzzle()` → store `{ answer, expiresAt: now()+ttlMs }` under a fresh `challenge_id = crypto.randomUUID()`; **lazy sweep** first (delete entries whose `expiresAt < now()`); return
  `{ result: "challenge", challenge_id, puzzle, expires_at: new Date(now()+ttlMs).toISOString(), instructions: "Call reverse_captcha again with { challenge_id, answer } before expires_at." }`.
- **Verify** (`challenge_id` + `answer` both present): look up the entry.
  - **Solved** (found, `now() <= expiresAt`, normalised answer matches): **delete** (single-use) → `{ result: "solved", message: "Solved it. You read the payload — that's the whole point. 🤖", about: { built_by: "Diego Ferreyra", site: "https://diegoferreyra.com" } }`.
  - **Wrong answer** (found, not expired, mismatch): **delete** (no infinite retries on one challenge) → `{ result: "wrong_answer", message: "Not quite. Issue a fresh one with no args and try again.", about: {...} }`.
  - **Expired or unknown** (not found, OR found-but-`now() > expiresAt`): delete if present → `{ result: "expired", message: "Too slow — challenges live ~10 seconds. Issue a fresh one. ⏱️", about: {...} }`. **Unknown-id and past-TTL deliberately collapse to the same `expired` payload — no oracle distinguishing "never existed" from "timed out".** A reused (already-verified) id reads as unknown → `expired`.
- **Exactly one of `{challenge_id, answer}` present** → `schema_violation` via the Zod paired refine (reads like any other bad input through the wrapper).

**Shape / registration (§3.4.4):**
- `reverseCaptchaShape = { challenge_id: z.string().optional(), answer: z.string().optional() }`, wrapped in a **paired `.refine`** on `z.object(reverseCaptchaShape)`: count present keys —
  - **both absent → VALID** (issue path; wrapper coerces `rawInput ?? {}` to `{}`, so a no-arg call is `{}` and must pass).
  - **both present → VALID** (verify path).
  - **exactly one present → refine FAILS** → `schema_violation`.
- Registered via `wrapToolHandler('reverse_captcha', reverseCaptchaSchema, (input) => Promise.resolve(reverseCaptchaHandler(input)))`. The handler needs **no `ToolDeps`** (store is module-local) — `registerReverseCaptcha(server, _deps)` keeps its signature for registry uniformity but ignores deps. **Registry order unchanged** (`registerReverseCaptcha` stays last in the read block, `registry.ts:53`).
- Tool description updated from the stub to: **"A timed logic puzzle for agents. Call with no args to get a challenge, then call again with { challenge_id, answer } within ~10 seconds."**

**Puzzle generator (§3.4.3)** — `generatePuzzle(): { puzzle: string; answer: string }` picks one of **two** templates at random (LOCKED at two — N3), fills randomised values, computes the canonical answer at generation time (stored, never re-derived on verify):
- **Template A — keyed extraction.** Emit a small labelled-record payload; ask for one field of the record matched by a key, e.g. *"Here are three records. Reply with the `color` of the record whose `id` is `47`: `[{id:12,color:teal},{id:47,color:amber},{id:88,color:rose}]`."* → answer `amber`. ids/colors randomised each issue.
- **Template B — ordered transform.** Give a short token list + a one-step instruction, e.g. *"Take this list — `[sky, 9, fern, 4, dusk]` — and reply with the words only, in reverse order, comma-separated."* → answer `dusk, fern, sky`.
- **Answer normalisation** (apply to both the agent's `answer` and the stored canonical before comparing): trim → lowercase → collapse internal whitespace; for list answers, normalise comma spacing to `", "`. Spelled out + unit-tested so trivial formatting differences don't fail a correct agent.

#### 4b — Version bump to 0.1.0 (spec §3.5) — 4 sync points + regression guard

Update all four lockstep sync points (currently drifted: `package.json`/`BINARY_VERSION` are `0.0.6` but `PHASE_STRING` still reads the stale `'v0.0.3 (policy engine + envelope)'`):
1. `package.json` `version` → `0.1.0`. (`"private": true` already dropped in Step 3.)
2. `src/core/version.ts` `BINARY_VERSION` → `'0.1.0'`. `BINARY_SCHEMA_VERSION` stays `2`.
3. `src/mcp/tools/read/whoami.ts` `PHASE_STRING` → **`'v0.1.0 (public release)'`** (replaces the stale `v0.0.3 …`).
4. `CHANGELOG.md` → finalize the dated `0.1.0` entry (started in Step 1).

- **Drift regression guard (C5/C6):** add an assertion that `PHASE_STRING` **contains** `BINARY_VERSION` (e.g. `expect(PHASE_STRING).toContain(BINARY_VERSION)`) so version.ts↔whoami drift can't recur silently.
- **Update the stale whoami test (CONCERN-1 — pin all three loci, no half-edit that leaves a green-but-lying test):** in `whoami.test.ts` —
  - **line ~70** — the `it('returns the Phase 3 phase string', ...)` title: **drop "Phase 3"** (e.g. `it('returns the current phase string', ...)`).
  - **line ~72** — `expect(result.phase).toBe(PHASE_STRING)` **stays as-is** (still holds against the new constant).
  - **line ~73** — `expect(result.phase).toMatch(/policy engine/)` **must change** to match the new `PHASE_STRING = 'v0.1.0 (public release)'`, e.g. `toMatch(/public release/)`.
- Health endpoint + MCP server name/version already read `BINARY_VERSION` (no edit needed).

**Tests (§5) — `reverse-captcha.test.ts` rewritten + a generator test:**
- issue returns the documented `{ result: "challenge", challenge_id, puzzle, expires_at, instructions }` shape.
- correct answer in time → `result: "solved"`; entry deleted (re-verify same id → `expired`).
- wrong answer in time → `result: "wrong_answer"`; entry deleted.
- expired (inject `now()`/`ttlMs` past `expiresAt`) → `result: "expired"` (no sleeping).
- unknown `challenge_id` → `result: "expired"`.
- whitespace/case-variant answer → accepted (normalisation).
- half-supplied input (`challenge_id` only / `answer` only) → `schema_violation` (paired refine; drive via `wrapToolHandler` to assert the envelope).
- generator: for each template the computed `answer` is derivable from the `puzzle` text (self-consistency) and answers vary across many generations (not constant).
- **whoami hint still present** — `whoami.hints` still contains `REVERSE_CAPTCHA_HINT` (the pointer didn't break).
- **registry still lists `reverse_captcha`** last in the read block (order assertion / `tools/list` includes it).
- the `PHASE_STRING ⊇ BINARY_VERSION` regression assertion.

_Reviewer focus (Step 5):_ no payload carries `ok` (B1 — would be misclassified as `isError` by `wrapper.ts:55-57`); paired refine matches the both-absent / both-present / exactly-one truth table; single-use deletion on every verify branch; lazy sweep on issue; unknown==expired collapse intentional; normalisation symmetric; injectable clock used by tests (no wall-clock dependency); `Math.random`/`Date.now` only in runtime source, not in any `scripts/*.mjs`.

Commit: `feat(mcp): full reverse_captcha timed puzzle + 0.1.0 version lockstep + drift guard (Step 4)`.

### Step 5 — 🛑 Code Reviewer pass (whole phase)

One Code Reviewer over `git diff main...HEAD`. This is the SINGLE consolidated gate — `reverse_captcha` is the only substantive logic; the reviewer also checks the workflows, packaging config, and docs in this pass.

- **`reverse_captcha` (primary):** B1 — no payload uses `ok` (every response `isError:false` via the `result` discriminant). Paired-refine truth table correct. Single-use deletion on solved/wrong/expired-found. Lazy sweep bounds the store. Unknown-id==expired collapse intentional. Normalisation symmetric + tested. Injectable clock drives the expired test (no sleeps). Registry order unchanged; `whoami` hint intact.
- **Workflows:** matrix `[ubuntu, macos, windows]` + `fail-fast:false` + Windows `continue-on-error`; CI runs the cross-platform checks (`build`/`test`/`ui test`/`lint`/`ui lint`/root `tsc --noEmit`/`format:check`/`smoke:concurrency`) on all 3 OSes with `test:smoke:ui` macOS-only; publish has `registry-url` + `NODE_AUTH_TOKEN` + build-before-publish and **no** `id-token: write` / `--provenance` (deferred to v1.x); C7 headings byte-identical across form + workflow + cross-ref comments; `needs-info-exempt` opt-out.
- **Packaging:** `private` removed; `publishConfig` is `{ "access": "public" }` only (no `provenance: true`); `bin` resolves; dry-run file list = whitelist exactly (`dist/ui/**` present, no source/tests/`.substrate/`).
- **Version lockstep:** all four sync points = `0.1.0`/`v0.1.0 (public release)`; `BINARY_SCHEMA_VERSION` still `2`; drift guard present; stale whoami test updated.

Fix BLOCKERs + CONCERNs in a `fix(review)` commit.

Commit: `fix(review): address Phase 6 Code Reviewer findings (Step 5)` (only if findings).

### Step 6 — Acceptance + 0.1.0 confirmation + audit + merge (Backend Engineer → Assistant)

**Acceptance gate (spec §5):**
- `pnpm build` (server + ui).
- `pnpm test` (server unit + integration).
- `pnpm --dir ui test` (UI sanitizer + components).
- `tsc` root + ui.
- `eslint` (root) + `pnpm --dir ui lint`.
- `prettier --check`.
- `pnpm test:smoke:concurrency`.
- manual MCP smoke (`node tests/manual/run-smoke.mjs`) **plus** an end-to-end `reverse_captcha` round-trip against a running `substrate mcp`: call with no args → call again with `{ challenge_id, answer }` → confirm `solved`.
- `pnpm test:smoke:ui` (Playwright; builds the UI first per 5b C5).
- **Packaging:** `pnpm build` THEN `pnpm publish --dry-run` (file list = whitelist exactly, `dist/ui/**` present) THEN `pnpm pack` + `npx ./<tarball> --help`/`init` smoke.
- **C7 build-isolation grep:** `dist/server/` contains no `react`/`marked`/`dompurify` (carried over from 5b — the server bundle stays UI-dep-free).
- Confirm the four version sync points are all `0.1.0` and the `PHASE_STRING ⊇ BINARY_VERSION` guard passes.
- (CI itself runs on the Phase 6 PR — the real cross-platform test surface; macOS + Linux blocking, Windows visible. Confirming CI green on a real PR is an operator step — §Operator item 4.)

Then:
- Spawn Assistant → `.agents/audits/phase-06-audit.md`. Resolve gaps.
- Fast-forward merge to `main`, tag **`phase-06-complete`**.
- **STOP here.** Do NOT push the `v0.1.0` release tag, do NOT publish — those are operator triggers (§Operator).

Commits: `chore(phase-06): acceptance pass + 0.1.0 (Step 6)`, `docs(phase-06): assistant audit (Step 6)`.

## 4. Operator tasks (NOT done by the agent — spec §6)

The agent's deliverable is "arm everything; Diego pulls the trigger." Removing `"private": true` (Step 3) is what *arms* publishing; the live steps remain operator-gated. The plan ends at `phase-06-complete`, everything publish-ready + dry-run-verified. Diego performs:
1. Create the public GitHub repo and push.
2. Configure the npm `@diegoferreyra` scope + publish access + 2FA.
3. Add the GitHub `NPM_TOKEN` secret for `publish.yml`.
4. Confirm CI is green on a real PR (macOS + Linux blocking; Windows visible).
5. Run the final fresh-machine quick-start walk-through (macOS + Linux).
6. Review `pnpm publish --dry-run` → **push the real `v0.1.0` tag** → `publish.yml` does the live `pnpm publish --access public` (no provenance for v0.1.0; deferred to v1.x).

## 5. Test mapping (spec §5 → plan)

| Spec requirement | Plan location |
|---|---|
| issue returns documented challenge shape | Step 4 (`reverse-captcha.test.ts`) |
| correct answer in time → solved (single-use delete) | Step 4 |
| wrong answer → wrong_answer (delete) | Step 4 |
| expired via injected clock/TTL → expired | Step 4 |
| unknown id → expired; reused id → expired | Step 4 |
| whitespace/case normalisation accepted | Step 4 |
| half-supplied input → schema_violation (paired refine) | Step 4 (via `wrapToolHandler`) |
| generator self-consistency + variance (both templates) | Step 4 (generator test) |
| whoami hint still present; registry still lists the tool | Step 4 |
| `PHASE_STRING ⊇ BINARY_VERSION` drift guard; stale whoami test updated | Step 4 |
| workflows lint / manual read (`actionlint` if available); CI runs on the PR | Step 2 + Step 6 (CI on PR = operator §6.4) |
| `pnpm build` → `--dry-run` whitelist (incl. `dist/ui/**`, no extras) | Step 3 + Step 6 |
| `pnpm pack` + `npx ./<tarball> init` manual smoke | Step 3 + Step 6 |
| C7 build-isolation grep (`dist/server` UI-dep-free) | Step 6 |
| full suite green (build/test/tsc/eslint/prettier/concurrency/manual MCP/UI smoke) | Step 6 |

## 6. Risks

- **R1 (B1 — `ok` misclassification):** an `{ ok: false }` verify payload would be flagged `isError` by `wrapper.ts:55-57`. Mitigation: every payload uses the `result` discriminant, never `ok`; reviewer greps the new file for `ok`.
- **R2 (non-deterministic expiry test):** mitigated by the injectable `now()`/`ttlMs` seams — no `sleep`, no wall-clock dependence.
- **R3 (C7 silent coupling break):** form-label↔workflow-heading drift silently disables auto-close. Mitigated by pinning the four `### ` headings + cross-referencing comments in both files; reviewer diffs them byte-for-byte.
- **R4 (C3 — empty dry-run):** `dist/` is gitignored; a dry-run on a clean tree gives false confidence. Mitigated by running `pnpm build` immediately before every `--dry-run`/`pack` (Step 3 + Step 6).
- **R5 (pnpm auth wiring + provenance deferral):** pnpm's `NODE_AUTH_TOKEN`/`.npmrc` wiring differs from npm. Mitigated by verifying the exact mechanism against the pinned `pnpm@7.18.2` in Step 2 and writing the workflow to match. **Provenance is deferred to v1.x:** `pnpm@7.18.2` has no `--provenance` flag and `pnpm-lock.yaml` is lockfileVersion 5.4 (pnpm-7); moving to provenance-capable pnpm 9 would force a 5.4 → 9 lockfile migration right before release — out of scope for v0.1.0. So v0.1.0 ships without `id-token: write` / `--provenance` / `provenance: true`; these return when the toolchain moves to pnpm 9.
- **R6 (version drift recurrence):** mitigated by the `PHASE_STRING ⊇ BINARY_VERSION` regression assertion.

## 7. Definition of Done

- All step commits on `feature/phase-06-oss-release`.
- Single Code Reviewer pass done (Step 5); BLOCKER/CONCERN findings resolved.
- Spec §5 acceptance gate met; dry-run + pack/npx smoke clean; C7 build-isolation grep clean.
- All four version sync points at `0.1.0` / `v0.1.0 (public release)`; drift guard passing.
- Assistant audit clean.
- Fast-forward merge to `main`, tag `phase-06-complete`. **Live publish + `v0.1.0` tag remain operator-gated.**
