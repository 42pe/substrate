# Phase 6 Audit — OSS Release v0.1.0 (artifacts + CI + npm publishing + full `reverse_captcha`)

**Date:** 2026-06-05
**Auditor:** Assistant agent (separate from authors and reviewers)
**Branch:** `feature/phase-06-oss-release`
**HEAD:** `317a343` — `feat(mcp): full reverse_captcha + npm publishing setup + v0.1.0 (Steps 3-4)`
**Commits this phase produced:** 3 on top of `main` (tag `phase-05b-complete`, `97c6d54`), plus the spec + plan doc commits.

## Summary table

| Category | Status |
|---|---|
| Stage 1 — Spec | DONE (APPROVED 2026-06-05; §3.0/§7 decisions locked; Architect Reviewer B1 + C1–C7 + N1–N5 incorporated) |
| Stage 2 — Planning | DONE (Architect Reviewer v1.1 APPROVE-WITH-CHANGES; provenance dropped for v0.1.0 per pnpm-7 constraint; CONCERN-1/2/3/4 + NITs incorporated) |
| Stage 3 — Development | DONE — Steps 1–4 committed (consolidated into 3 commits); lint/format/types/build all clean |
| Stage 4 — QA | DONE — 422 server tests + 10 ui + 16 captcha/whoami green; concurrency smoke (60s) green; pack+npx bin smoke green; dry-run + dist-isolation clean |
| Stage 5 — Phase-end | DONE with notes (accepted residuals: provenance deferred to v1.x; CI unproven until a real push; 413 KB UI bundle carried from 5b; OPERATOR-ONLY publish boundary) |

## Hard gates compliance (workflow.md §"Hard Gates")

| # | Gate | Evidence |
|---|---|---|
| 1 | No plan without an approved spec | `.agents/plans/specs/phase-06-spec.md` — `Status: APPROVED (… B1 + C1–C7 + N1–N5 addressed) — ready for planning.` |
| 2 | No development without an approved plan | `.agents/plans/phase-06-oss-release.md` — `Status: Reviewed v1.1 (Architect Reviewer APPROVE-WITH-CHANGES …) — ready for development.` |
| 3 | No commits without code review | The Code Reviewer gate (Step 5) ran on the **staged working tree before any commit** — see deviation note below. There is **no separate `fix(review)` commit**; the single review finding (auto-close label `needs-info` → `incomplete`, to match the spec) was folded into commit `835cf1a`, whose body states: `close label 'incomplete' (Step 5 review fix — aligned with the spec)`. I confirmed the workflow label is `incomplete` (lines 60, 67) and it matches spec §3.2 + the §4 edge-case table. |
| 4 | No PR without Assistant audit | This document, written by an agent separate from the authors. |

All four hard gates are satisfied. Gate 3 has a weaker in-repo artifact than 5b (no standalone `fix(review)` commit) because of the pre-commit review deviation — documented honestly below; the review *did* run and its one finding *is* reflected in the committed workflow.

## Process deviations (verified, documented honestly)

1. **Code Reviewer gate ran pre-commit, on the staged tree.** The commit-signing agent (1Password `op-ssh-sign`) was intermittently unavailable, forcing all implementation to be staged and reviewed *before* commit, then committed in one signing window. This is arguably **stronger** than reviewing post-commit (nothing un-reviewed ever entered history), but the trade-off is there is no `fix(review)` commit artifact — the single finding (label `needs-info` → `incomplete`) is folded into `835cf1a`. **Verified:** the label in `auto-close-incomplete-issues.yml` is `incomplete` and matches the spec.

2. **Commits initially landed on `main`, then relocated.** The Phase 6 commits were first made directly on `main`, then relocated onto `feature/phase-06-oss-release` with `main` reset back to `phase-05b-complete` (`97c6d54`, tag `phase-05b-complete`) to restore the canonical feature-branch → ff-merge flow. **Verified:** `main` is at `97c6d54` = tag `phase-05b-complete`; the three Phase 6 commits sit only on the feature branch. `main` was never pushed.

3. **Per-step commits consolidated into 3 (not one-per-step).** Same signing-window constraint, plus `package.json` changes span Steps 3 and 4. The plan named Steps 1–6; in practice: Step 1 → `2fc069c` (docs), Steps 2+5 → `835cf1a` (workflows + the folded review fix), Steps 3+4 → `317a343` (packaging config + `reverse_captcha` + version). Acceptance (Step 6) was run in-session; the audit doc lands separately. **Non-blocking; the whole diff was reviewed as one unit, which the plan explicitly designed for (single consolidated gate).**

## Commit list (`main..HEAD`)

```
317a343 feat(mcp): full reverse_captcha + npm publishing setup + v0.1.0 (Steps 3-4)
835cf1a ci(oss): GitHub Actions CI/publish/auto-close + issue templates (Steps 2, 5)
2fc069c docs(oss): README quick-start, CONTRIBUTING, SUPPORT, CHANGELOG, examples (Step 1)
3861443 docs: Phase 6 plan (reviewed v1.1, ready for development)
22cdf82 docs: Phase 6 spec (approved, incorporates Architect Reviewer changes)
```

The three implementation commits map to the plan's six steps as: Step 1 (`2fc069c`), Steps 2 + the Step 5 review fix (`835cf1a`), Steps 3 + 4 (`317a343`). The Step 6 acceptance/version-bump work is folded into `317a343` (version lockstep) rather than its own `chore(phase-06)` commit; this audit doc is the planned `docs(phase-06): assistant audit`. **Deviation:** the plan choreographed per-step commits + a conditional `fix(review)` + a separate `chore(phase-06)` acceptance commit; in practice the commits are consolidated to three (see deviation 3). Working tree is clean at `317a343`.

## Spec §2 / §4 acceptance criteria

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | `reverse_captcha` no args → issues `{ result:"challenge", challenge_id, puzzle, expires_at, instructions }`, `isError:false` | PASS | `reverse-captcha.ts:177–191` (issue path). Test "issues a challenge …" asserts id/instructions/puzzle/ISO expiry. No payload carries `ok` → wrapper marks `isError:false`. |
| 2 | verify correct in time → `{ result:"solved" }`, single-use delete | PASS | `reverse-captcha.ts:152–168`; entry deleted on line 154 *before* the branch. Tests "solves a correct …" + "is single-use: … cannot be replayed" (replay → `expired`). |
| 3 | verify wrong in time → `{ result:"wrong_answer" }`, delete | PASS | `reverse-captcha.ts:170–174`. Test "rejects a wrong answer → result: wrong_answer". |
| 4 | verify after `expires_at` → `{ result:"expired" }` | PASS | `expiresAt <= t` check (line 155). Test "reports an answer submitted after the TTL → result: expired" via injected `now()`, no sleep. |
| 5 | verify unknown `challenge_id` → `{ result:"expired" }` (no oracle) | PASS | unknown == past-TTL collapse (line 155). Test "treats an unknown challenge_id the same as expired (no oracle)". |
| 6 | reused (already-verified) id → `expired` | PASS | single-use delete → reads as unknown. Test "is single-use" second call → `expired`. |
| 7 | exactly-one arg present → `schema_violation` (paired refine) | PASS | `reverseCaptchaSchema` paired `.refine` (`(d.challenge_id===undefined)===(d.answer===undefined)`). Tests "accepts neither/both" + "rejects exactly one arg present". Surfaces through `wrapToolHandler` as a `schema_violation` envelope. |
| 8 | whitespace/case-variant answer accepted (normalisation) | PASS | `normalize()` = trim → lowercase → collapse internal whitespace, applied to both stored answer and submitted answer (symmetric). Test "accepts answers case-insensitively / whitespace-trimmed" (`  UPPER  `). |
| 9 | many issues without verifies → lazy sweep bounds store | PASS | sweep loop `reverse-captcha.ts:178–180` on every issue; plus single-use delete on verify. No timers/`setInterval`. |
| 10 | `pnpm publish --dry-run` (after build) = `dist/**` + README/LICENSE/CHANGELOG + package.json, no extras | PASS | Ran first-hand: **85 files**, all under `dist/**` (incl. `dist/ui/**` SPA) + the 3 root docs + `package.json`. No `src/`, `tests/`, `.substrate/`, `ui/src`, or dotfiles. `CONTRIBUTING.md`/`SUPPORT.md` correctly absent from the tarball. |
| 11 | issue missing `substrate diagnose` → auto-close comments + closes with `incomplete` | PASS (by read) | `auto-close-incomplete-issues.yml:60` adds label `incomplete` + closes; the four required headings (lines 31–36) are byte-identical to the four `bug_report.yml` `label:` fields. Unproven until it runs on a real GitHub repo (see residuals). |
| 12 | Windows CI leg fails → job shows failure, `continue-on-error`, required check green | PASS (by read) | `ci.yml:21` `continue-on-error: ${{ matrix.os == 'windows-latest' }}`, `fail-fast: false`. Unproven until CI runs (residual). |
| 13 | `BINARY_VERSION` → `0.1.0`; `BINARY_SCHEMA_VERSION` stays `2` (no migration) | PASS | `version.ts:22` `BINARY_VERSION='0.1.0'`; `version.ts:10` `BINARY_SCHEMA_VERSION=2`. Packed CLI prints `Substrate v0.1.0`. No migration file added. |

## Version lockstep (spec §3.5 — the drift fix)

The lockstep that silently drifted (`PHASE_STRING` stuck at `v0.0.3` through three releases) is resynced and guarded. Independently verified:

- `package.json` `version` → `0.1.0` (diff: `0.0.6` → `0.1.0`; `"private": true` removed in the same hunk).
- `src/core/version.ts` `BINARY_VERSION` → `'0.1.0'`; `BINARY_SCHEMA_VERSION` stays `2`.
- `whoami.ts:39` `PHASE_STRING` is now **derived** from the constant: `` `v${BINARY_VERSION} (public release)` `` — not a hand-copied literal, so it *cannot* drift from `BINARY_VERSION` again.
- `CHANGELOG.md` has a `[0.1.0] — first public release` entry folding Phase 1–5b, with the provenance-deferral and platform-support notes.
- **Drift guard present and real:** `whoami.test.ts:76` `expect(result.phase).toContain(\`v${BINARY_VERSION}\`)` + `:77` `toMatch(/public release/)`. The **stale `/policy engine/` assertion is gone** — confirmed via grep across the tree (no remaining `/policy engine/` assertion in `whoami.test.ts`).

## `reverse_captcha` feature/security review (the headline deliverable)

The B1 constraint (no `ok` field → never misclassified as `isError`) is the load-bearing invariant. Independently verified:

- **No payload carries `ok`.** `grep "\bok\b" reverse-captcha.ts` returns exactly **one** hit — a *comment* (line 26) documenting the invariant. The `ReverseCaptchaResult` union uses a `result` discriminant (`'challenge' | 'solved' | 'wrong_answer' | 'expired'`), never `ok`. `wrapper.ts:55–57` flags `ok === false` as `isError:true`; since no payload has `ok`, all five stay `isError:false`. The test "every response … no ok field (stays isError:false)" asserts `not.toHaveProperty('ok')` across challenge/solved/expired.
- **Paired refine matches the truth table.** both-absent → VALID (issue), both-present → VALID (verify), exactly-one → INVALID → `schema_violation`. Source + tests both confirm. `challenge_id` additionally `.min(1)` so an empty-string id can't sneak the verify path.
- **Single-use on every found branch.** The entry is deleted (line 154) *before* the expired/solved/wrong branching, so solved, wrong_answer, and expired-but-found all consume the challenge. No replay.
- **Injectable clock — no wall-clock dependence.** `reverseCaptchaHandler(input, { now, ttlMs })` defaults to `Date.now`/`DEFAULT_TTL_MS`; the expired test drives `now()` past `expiresAt` with no `sleep`. `__resetStore()` runs in `beforeEach`. Tests are deterministic — re-ran the suite, 16/16 green in 213ms.
- **Generator is payload-dependent + self-consistent.** Two templates only (locked at two): keyed-extraction (read a value by key from a JSON object) and ordered-transform (reverse a word list, join with `-`). The test `solveFromPuzzle` re-derives the answer by *reading* the issued puzzle — proving the puzzle is self-contained and not guessable. Answer computed at issue time, stored, never re-derived on verify.
- **`Math.random`/`Date.now` only in runtime source.** `grep "Math.random|Date.now" scripts/` → none. The generator uses both — permitted by §3.0.4 (runtime source, not a `scripts/*.mjs` workflow).
- **Registry order unchanged.** `registry.ts:53` `registerReverseCaptcha` is last in the read block (after `registerGetComment`). `whoami` hint intact: `whoami.ts:42` `REVERSE_CAPTCHA_HINT` still in `hints`, asserted by `whoami.test.ts:66–69`.

**One spec-vs-implementation wording note (non-blocking, no functional gap):** spec §3.4.3 Template B's *illustrative example* shows a comma-separated answer (`"dusk, fern, sky"`) and §3.4.3 mentions "normalise comma spacing" for list answers. The implementation chose a **hyphen-joined** answer (`dusk-fern-sky`) instead, so there are no list-comma answers and the comma-spacing normalisation rule is moot. The chosen normalisation (trim/lowercase/collapse-whitespace) is symmetric and tested, and the spec examples were explicitly "e.g." sketches, not locked strings (the locked decision §7.2 says "reverse/filter a short list … normalised (trim/lowercase/whitespace)"). The manual smoke and unit tests both solve the hyphen form. **Consistent with the locked decision; the comma example was illustrative.**

## npm packaging (spec §3.3)

- **`"private": true` removed** (diff confirmed) — this is what *arms* publishing; the live publish stays operator-gated.
- **`publishConfig: { "access": "public" }`** only — **no `provenance: true`** (intentional; pnpm 7.18.2 predates `--provenance`).
- **`packageManager: "pnpm@7.18.2"`** — matches the dev machine (`pnpm --version` → `7.18.2`, confirmed first-hand). `pnpm-lock.yaml` unchanged (the field adds no deps), so `--frozen-lockfile` still passes.
- **`files: ["dist","README.md","LICENSE","CHANGELOG.md"]`**; no `.npmignore`, whitelist governs. Dry-run = exactly `dist/**` + 3 docs + package.json (85 files).
- **`bin: { "substrate": "./dist/server/cli/index.js" }`** — built file has `#!/usr/bin/env node` shebang and the executable bit (`.rwxr-xr-x`). **First-hand pack+npx smoke:** packed the 0.1.0 tarball, `npx ./<tgz> --help` printed `Substrate v0.1.0 …`, and `npx ./<tgz> init` created a working `.substrate/` (config.json, boards/, data.sqlite) in a temp dir. The packed binary genuinely runs.
- **dist/server is UI-dep-free (C7).** `grep -rlE "from ['\"](react|marked|dompurify)" dist/server/` → no matches (exit 1).

## CI / publish / auto-close workflows (spec §3.2)

- **`ci.yml`:** matrix `[ubuntu, macos, windows]`, `fail-fast: false`, `continue-on-error: ${{ matrix.os == 'windows-latest' }}`. Cross-platform leg runs `build` → root `tsc --noEmit` → ui `tsc --noEmit` → `lint` → ui `lint` → `format:check` → `test` → ui `test` → `test:smoke:concurrency`. macOS-only: `playwright install chromium` + `test:smoke:ui`. Both root and ui installs (`--frozen-lockfile`) present (ui is a separate package, not a workspace member). `pnpm/action-setup@v4` reads the `packageManager` pin (no explicit version). Node 20 (matches `engines: ">=20"`).
- **`publish.yml`:** on tag `v*`, `ubuntu-latest`, `permissions: { contents: read }` — **no `id-token: write`** (provenance deferred). `setup-node` with `registry-url: 'https://registry.npmjs.org'`; `pnpm install --frozen-lockfile` (root + ui) → **`pnpm build` before publish** → `pnpm publish --access public --no-git-checks` with `env: NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`. **No `--provenance`.**
- **`auto-close-incomplete-issues.yml`:** on `issues: [opened, edited]`, `actions/github-script@v7`. Skips `needs-info-exempt` (opt-out) and only enforces on `bug`-labelled issues; greps the **rendered body headings** (`### Node version`, `### Operating system`, `` ### `substrate diagnose` output ``, `### Reproduction steps`), treats `_No response_` as blank, posts a templated comment (idempotent via a `<!-- auto-close-incomplete -->` marker), labels **`incomplete`**, and closes; reopens + removes the label when later completed. The four required strings are **byte-identical** to the `bug_report.yml` field labels, and each file carries a cross-referencing comment naming the other.
- **`bug_report.yml`:** four required fields (`required: true` on each), auto-applies `labels: ['bug', 'needs-triage']` so form-filed issues are in scope of the auto-close `bug`-label gate. `config.yml`: `blank_issues_enabled: false` (enforces the form).

## Test results (first-hand this audit)

| Suite | Files | Tests | Result |
|---|---|---|---|
| `pnpm test` (server unit + integration) | 54 | **422** passed | green (18.4 s) |
| `reverse-captcha.test.ts` + `whoami.test.ts` (targeted) | 2 | **16** passed | green (213 ms) |
| `pnpm --dir ui test` (jsdom: sanitizer + components) | 3 | **10** passed | green (1.6 s) |
| `pnpm exec tsc --noEmit` (root) | — | — | clean (exit 0) |
| `pnpm exec eslint .` (root) | — | — | clean (exit 0) |
| `pnpm exec prettier --check .` | — | — | clean ("All matched files use Prettier code style!") |
| `pnpm build` (server + ui) | — | — | clean (ui 413.35 KB JS / 15.55 KB CSS, exit 0) |
| `pnpm test:smoke:concurrency` (60 s) | 1 | 1 passed | green (60.4 s) |
| `pnpm publish --dry-run` (after build) | — | — | 85 files, whitelist-exact, exit 0 |
| `pnpm pack` + `npx ./<tgz> --help` / `init` | — | — | CLI prints `v0.1.0`, `init` creates `.substrate/` (green) |
| dist/server UI-dep grep (C7) | — | — | clean (no react/marked/dompurify) |

**422 server passing** — +10 over Phase 5b's 412 (the rewritten `reverse-captcha.test.ts` is ~9 cases + the whoami drift guard; the captcha suite is 11 of those tests). The manual MCP smoke (`run-smoke.mjs`) now does a real `reverse_captcha` issue→solve round-trip asserting `result: "solved"` (verified by reading the updated `run-smoke.mjs`; I re-ran the unit/integration/concurrency suites first-hand but did not spawn the full stdio manual smoke in this audit — see residual 5). Playwright UI smoke not re-executed in this audit (carried green from 5b; CI wires it on macOS).

## Coverage notes (tested vs. gaps)

**Well covered.** `reverse_captcha` is the most-tested surface this phase: issue shape, solved/wrong/expired branches, unknown==expired collapse, single-use replay, case/whitespace normalisation, the paired-refine truth table, distinct-id minting, and the no-`ok` invariant — all unit-tested with an injectable clock (no sleeps). The version drift guard is now a standing assertion. Packaging is verified at three levels: dry-run file list, a real `pnpm pack`, and an `npx`-from-tarball `--help` + `init` smoke.

**Gaps / thin spots (none blocking):**

1. **Workflows are unproven until they run on a real GitHub repo.** `ci.yml`, `publish.yml`, and `auto-close-incomplete-issues.yml` are authored and read-verified (heading coupling byte-checked, label confirmed), but no `actionlint` was run in this audit and none has executed on a real push. The auto-close `_No response_` heuristic, the Windows `continue-on-error` behaviour, and the macOS Playwright leg are all unobserved. **This is operator step §6.4 (confirm CI green on a real PR) — explicitly out of the agent's reach.**
2. **Auto-close enforces only on `bug`-labelled issues.** A non-form issue without the `bug` label is never checked. Intended (the form auto-applies `bug`, and the gate is scoped to bug reports), but worth noting the coupling: if the `bug_report.yml` label list is ever edited to drop `bug`, auto-close silently stops firing — a second silent-coupling surface beyond the four headings.
3. **Manual stdio MCP smoke not re-executed in this audit.** The `run-smoke.mjs` reverse_captcha round-trip is verified by code read; I re-ran the vitest suites + concurrency smoke first-hand but did not spawn the full manual MCP client. Accepted on the same basis as prior phases.

## Scope deviations from spec

1. **Template B answer is hyphen-joined, not comma-separated** (spec §3.4.3 example showed commas). The comma-spacing normalisation in the spec is consequently unused. Functionally equivalent, symmetric normalisation tested, locked decision §7.2 only required "reverse/filter a short list, normalised". **Illustrative example, not a locked string; non-blocking.**
2. **Provenance dropped for v0.1.0** — the plan (v1.1) already revised the spec's `{ access, provenance:true }` + `id-token: write` + `--provenance` down to access-only, because pnpm 7.18.2 has no `--provenance` and a pnpm-9 bump would force a lockfile 5.4 → 9 migration pre-release. `publishConfig`, `publish.yml`, and the CHANGELOG all consistently omit provenance. **Per the reviewed plan; deferred to v1.x.**
3. **Commits consolidated to 3** (see process deviation 3). The plan's per-step + `fix(review)` + `chore(phase-06)` choreography is collapsed. **Process, not code; non-blocking.**

## Residual risks / deferrals (flagged, not fixed)

1. **R1 — npm provenance deferred to v1.x.** v0.1.0 ships without supply-chain provenance attestation. The toolchain (pnpm 7.18.2, lockfile 5.4) predates `--provenance`; restoring it needs a pnpm-9 bump + lockfile migration. **Accepted/intentional per plan v1.1; track for the first v1.x release.**
2. **R2 — OPERATOR-ONLY boundary.** The agent stops at `phase-06-complete`. The live `npm publish`, the real `v0.1.0` tag push (which fires `publish.yml`), public GitHub repo creation, npm `@diegoferreyra` scope/token/2FA, and the GitHub `NPM_TOKEN` secret are **all Diego's** (spec §6). Removing `"private": true` *arms* publishing; nothing in this phase *pulls the trigger*. **By design.**
3. **R3 — CI authored but unproven.** The three workflows have never run. Their correctness (auto-close heuristic, Windows non-blocking, macOS Playwright leg, pnpm auth wiring) is verified only by read until a real PR/tag exercises them. **Operator §6.4 closes this; carry as the first thing to watch post-merge.**
4. **R4 — 413 KB single-chunk UI bundle (carried from 5b).** No code-splitting, no CI bundle-size budget. Fine for a localhost-only inspector loaded once; the Phase 5b audit already flagged it. **Accepted for v1.**
5. **R5 — Manual MCP smoke + Playwright not re-executed in this audit.** Verified by code read (round-trip logic) and carried green from prior session/5b. **Accepted on instruction.**
6. **R6 — Two silent-coupling surfaces in the issue-hygiene pipeline.** (a) the four `### ` headings shared between `bug_report.yml` and the workflow, and (b) the `bug` label gate. Both are guarded by cross-referencing comments, but a label/heading edit on one side silently disables auto-close. **Accepted; the cross-ref comments are the guardrail — keep them.**

## Verdict

**PASS-WITH-NOTES — go for fast-forward merge to `main` + tag `phase-06-complete` (live publish + `v0.1.0` tag push remain operator-gated).**

Phase 6 substantively meets every spec acceptance criterion. The headline deliverable — the full `reverse_captcha` — is correct and independently re-verified: the B1 invariant holds (no payload carries `ok`; the only `ok` in the file is the comment documenting why; all five payloads stay `isError:false`), the paired refine matches the both-absent/both-present/exactly-one truth table, every found challenge is single-use (deleted before branching, replay → `expired`), unknown-id and past-TTL collapse to one `expired` with no oracle, normalisation is symmetric and case/whitespace-tested, and the expired branch is driven by an injectable clock with zero wall-clock dependence (16/16 captcha+whoami tests green, deterministic). The version lockstep is resynced **and** made structural — `PHASE_STRING` now *derives* from `BINARY_VERSION`, so the v0.0.3 drift can't recur, backed by a standing `toContain(v${BINARY_VERSION})` guard; the stale `/policy engine/` assertion is gone.

Packaging is verified first-hand at three depths: dry-run (85 files = `dist/**` incl. the SPA + README/LICENSE/CHANGELOG + package.json, no source/tests/`.substrate`/dotfiles, `CONTRIBUTING`/`SUPPORT` correctly excluded), a real `pnpm pack`, and an `npx`-from-tarball that prints `Substrate v0.1.0` and `init`-s a working `.substrate/`. `"private"` is removed (arming publish), `publishConfig` is access-only (no provenance, intentional for pnpm 7), `packageManager` matches the dev pnpm, and the bin has its shebang + exec bit. dist/server stays UI-dep-free (C7 grep clean). All locally-runnable gates pass: 422 server + 10 ui tests, root tsc/eslint/prettier clean, build clean, 60s concurrency smoke green.

The notes are process and unobservable-CI, not code. The Code Reviewer gate ran **pre-commit on the staged tree** (signing-agent outage), which is arguably stronger but leaves no `fix(review)` artifact — its one finding (label → `incomplete`) is verified present in the committed workflow. Commits were consolidated to three and were briefly on `main` before relocation to the feature branch (main never pushed; now correctly at `phase-05b-complete`). The three GitHub Actions workflows are authored and read-verified (the four auto-close headings are byte-identical to the form labels, the close label is `incomplete`, Windows is non-blocking, publish has registry-url + token + build-before-publish and no id-token/provenance) but **unproven until they run on a real push** — that confirmation is operator step §6.4. npm provenance is deferred to v1.x; the 413 KB UI bundle carries over from 5b. None block the merge; all are consistent with the spec's locked decisions and the OPERATOR-ONLY release boundary.

Recommended next actions (Orchestrator):
1. Fast-forward merge to `main`, tag `phase-06-complete`. **Do NOT push the `v0.1.0` tag or publish — operator triggers (§6).**
2. **Operator (Diego):** create the public repo + push → confirm CI green on a real PR (the first real exercise of all three workflows; watch the auto-close `_No response_` heuristic and the macOS Playwright leg) → configure npm scope/2FA + the `NPM_TOKEN` secret → review `pnpm publish --dry-run` → push the real `v0.1.0` tag to fire `publish.yml`.
3. **Carry into v1.x:** restore npm provenance once the toolchain moves to pnpm 9 (re-add `id-token: write` + `--provenance` + `publishConfig.provenance`); consider a CI bundle-size budget for the UI chunk.
4. Flip plan status to `Complete`.
