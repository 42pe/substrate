# Phase 1 Audit — Walking Skeleton

**Date:** 2026-05-28
**Auditor:** Assistant agent (separate from authors and reviewers)
**Branch:** `feature/phase-01-walking-skeleton`
**HEAD:** `62c974b` — `test(manual): programmatic MCP smoke runner (Procedure C)`
**Commits this phase produced:** 17 on top of `main`

## Summary table

| Category | Status |
|---|---|
| Stage 1 — Spec | DONE |
| Stage 2 — Planning | DONE |
| Stage 3 — Development | DONE with one finding (prettier check fails on `tests/manual/run-smoke.mjs`) |
| Stage 4 — QA | DONE |
| Stage 5 — Phase-end | DONE with notes (PRD/decisions intentionally not updated; React/Vite resolved-version deviations) |

## Hard gates compliance (workflow.md §"Hard Gates")

| # | Gate | Evidence |
|---|---|---|
| 1 | No plan without an approved spec | `.agents/plans/specs/phase-01-walking-skeleton-spec.md` exists with `Status: ✅ Approved 2026-05-09`. |
| 2 | No development without an approved plan | `.agents/plans/phase-01-walking-skeleton.md` exists with `Status: Revised v1.1 (post Architect Reviewer pass — ready for development)`. |
| 3 | No commits without code review | Plan called for Code Reviewer after Steps 4, 6, 7, 9. Four `fix(review):` commits land on the branch (`9311256`, `27e24f7`, `c3b41a2`, `4538333`) corresponding to those checkpoints. |
| 4 | No PR without Assistant audit | This document is that audit; written by an agent separate from the authors. |

All four hard gates are satisfied.

## Phase Completion Checklist

### Stage 1 — Spec

- [DONE] Spec team analysts spawned and produced research findings — Spec header explicitly states "Spec Team analysts skipped for this bootstrap phase per workflow.md small/clear-scope rule" (workflow.md §"Team Sizing by Scope" permits this for Small/bootstrap scope).
- [DONE] Spec at `.agents/plans/specs/phase-01-walking-skeleton-spec.md`.
- [DONE] Open questions resolved — spec §6 lists 5 resolved decisions with Diego, 2026-05-09.
- [DONE] Diego approved spec before planning — spec marked "✅ Approved 2026-05-09".

### Stage 2 — Planning

- [DONE] Plan at `.agents/plans/phase-01-walking-skeleton.md`.
- [DONE] Architect Reviewer review — plan header references "post Architect Reviewer pass" and §8 lists 15 reviewer concerns with resolutions.
- [DONE] Plan revised after review — version v1.1; §8 enumerates each concern + how it was addressed (dependency pinning, atomic-write deferral, vitest pool, shebang script, rootDir split, etc.).
- [DONE] Diego approved plan before development — plan is in `feature/phase-01-walking-skeleton` and 16 implementation commits followed it.

### Stage 3 — Development

- [DONE] All automated tests pass — `pnpm test` → **127 tests passed, 19 files, 0 failures**.
- [DONE] No outstanding known bugs — clean working tree; no `TODO: bug`, no failing tests, no `.only` left in suite.
- **[MISSING] Formatting passes** — `pnpm exec prettier --check .` exits **1**. `tests/manual/run-smoke.mjs` (added in HEAD commit `62c974b`) has two lines exceeding the 100-char width that Prettier wants wrapped. Remediation: `pnpm exec prettier --write tests/manual/run-smoke.mjs` and amend. Two-line trivial diff; does not affect runtime behaviour.
- [DONE] Linting passes — `pnpm exec eslint .` exit 0.
- [DONE] TypeScript check passes — `pnpm exec tsc --noEmit` (root) exit 0; `cd ui && pnpm exec tsc --noEmit` exit 0.
- [DONE] Frontend builds — `pnpm build:ui` produces `dist/ui/index.html` + assets (192 KB JS / 8 KB CSS / 0.44 KB HTML, gzipped 60.6/2.4/0.29 KB).
- [DONE] Code Reviewer BLOCKERs resolved — four `fix(review):` commits land for the four planned checkpoints; no `BLOCKER` markers remain in branch history or in current files.
- [DONE] Code Reviewer CONCERNs addressed — covered by the same four review-fix commits.
- [DONE] New tests written for new functionality — every Phase 1 module has `*.test.ts` next to it (16 unit test files); integration covers MCP `create_task`, serve lifecycle, schema-version guard; smoke covers 60s concurrency.
- [N/A] Existing tests updated — no pre-existing tests (this is the walking skeleton).
- [DONE] Test fixtures / factories updated — `tests/fixtures/SampleSaaS/config.json` + README, `tests/helpers/spawn.ts`.

### Stage 4 — QA

- [DONE] End-to-end QA performed locally — manual MCP-client smoke run via Procedure C (`node tests/manual/run-smoke.mjs`). HEAD commit message records: `✓ substrate init / ✓ connect MCP / ✓ tools/list (create_task, whoami) / ✓ whoami / ✓ create_task envelope ok:true, version 1, policies_fired=[]`. Pre-existing `tests/manual/README.md` documents Procedures A (MCP Inspector), B (Claude Code), C (programmatic SDK).
- [DONE] QA declared "pass" — Step 11 acceptance pass landed in `2b10325 chore(phase-01): final acceptance pass`.
- [N/A] No console errors in UI normal-path — Phase 1 UI is a hello-world fetching `/api/health`; full UI/console-audit lands in Phase 5.

### Stage 5 — Phase-end

- [DONE] Assistant audit produced — this file.
- [DONE] Plan status updated — header reads `Status: Revised v1.1 (post Architect Reviewer pass — ready for development)`. (Note: plan doc still says "ready for development" rather than "Complete"; cosmetic, captured as a follow-up below.)
- [N/A] PRD updated — no architecture, scope, or non-goals changed; Phase 1 implements exactly what PRD §7 + v1-architecture §5 specified. No PRD edit warranted.
- [N/A] Decisions log updated — non-obvious decisions for Phase 1 were already captured pre-development (libsql native vs WASM, independent-process arch, etc.) in earlier 2026-05-09 entries. Nothing new arose during implementation that warranted a fresh decision entry. (See "Findings" for two small deviations worth recording in Phase 2 spec.)
- [DONE] README updated — README.md exists with pre-release notice; full README ships in Phase 6 per spec §3.1 ("README.md — placeholder (full README is Phase 6)").
- [N/A] CHANGELOG.md updated — Spec §3.1 + Plan Step 1 explicitly say placeholder only for Phase 1; "first real entry in Phase 6" (plan §8). CHANGELOG.md confirms placeholder-only state.
- [N/A] `examples/` updated — Phase 1 ships only `create_task` + `whoami`. `examples/` directory is a Phase 6 deliverable per PRD; no `examples/` exists yet and none required by Phase 1 spec.
- [DONE] No secrets committed — `git diff main..feature/phase-01-walking-skeleton` shows only test-fixture "secret" strings (e.g., `"DB password is hunter2"`) used to verify the error-handler middleware does NOT reflect internal errors. No real credentials, API keys, or tokens.
- [DONE] Feature branch up to date with main — branched from `823eb7c` per plan §2; main has not advanced.
- [DONE] Commits are logical and descriptive — 17 commits, one per Step plus four review-fix commits and a Procedure-C follow-up; commit messages all reference the Phase 1 Step they implement.
- [N/A] PR description — Orchestrator authors after audit; not yet created.
- [N/A] Post-merge steps — none beyond standard tag (`phase-01-complete` per plan §2 and §4 Step 12).
- [DONE] Known issues / follow-ups captured — see "Findings" below.

## Test results

| Suite | Files | Tests | Duration | Result |
|---|---|---|---|---|
| `pnpm test` (unit + integration) | 19 | **127** passed | 13.05 s | green |
| └─ project `unit` | 16 | 118 passed | 0.62 s | green |
| └─ project `integration` | 3 | 9 passed | 15.46 s | green |
| `pnpm test:smoke:concurrency` (60 s) | 1 | 1 passed | 60.31 s | green |
| `pnpm exec tsc --noEmit` (root) | — | — | — | clean (exit 0) |
| `cd ui && pnpm exec tsc --noEmit` | — | — | — | clean (exit 0) |
| `pnpm exec eslint .` | — | — | — | clean (exit 0) |
| `pnpm exec prettier --check .` | — | — | — | **FAIL** — `tests/manual/run-smoke.mjs` not formatted (exit 1) |
| `pnpm build` | — | — | — | clean (shebang prepended, chmod +x verified, UI built) |
| Manual MCP-client smoke (Procedure C) | — | 5/5 checks | ~5 s | pass (recorded in HEAD commit message) |

Build artifact verified: `dist/server/cli/index.js` is `0o755`, starts with `#!/usr/bin/env node`.

## Findings and notes for the next phase

1. **BLOCKER (small): `tests/manual/run-smoke.mjs` fails `prettier --check`.** Introduced in HEAD commit `62c974b`. Two lines need wrapping. Remediation: run `pnpm exec prettier --write tests/manual/run-smoke.mjs` and amend HEAD (or land a `style:` commit). Recommended fix before PR creation. Without this fix the Phase Completion Checklist Stage 3 "Formatting passes" item is MISSING.

2. **Plan-doc deviation: React 19 / Vite 8 / TypeScript 6 actually landed.** Plan §3 listed `react 18.x.y`, `vite 6.x.y`, `typescript 5.x.y` as pinned versions, with the note "resolved at first install; lockfile committed". Installed at resolution time: `react 19.2.6`, `vite 8.0.14`, `typescript 6.0.3`. PRD §7 still says "React 18". This is a documentation drift, not a functional regression — all tests + tsc + build pass cleanly under the newer versions. Recommendation: capture in `decisions.md` ("React 18 → React 19 at install time; reason: latest stable; impact: TanStack Router compat will be checked in Phase 5") and update PRD §7 to read "React 19" so future agents do not rebuild against a stale spec.

3. **Plan-doc deviation: shared `db.ts` lifecycle helper landed at `src/storage/client.ts` instead of `src/shared/db.ts`.** Plan §4 Step 3 specified `src/shared/db.ts`; reviewer-confirmed move to `src/storage/client.ts` is documented inline in plan §6 ("storage layer is the architecturally cleaner home; reviewer-confirmed"). Implementation matches the revised location. Worth noting in Phase 2 spec so anyone re-reading the plan does not look in the wrong directory.

4. **busy_timeout quirk to remember in Phase 2.** Storage layer sets `PRAGMA busy_timeout = 5000` per spec §3.2. The smoke test passed 60 s with zero errors; whoever designs Phase 2's `update_task` / version-CAS path should re-verify the timeout still holds when transactions get longer (currently every write is a single-statement insert).

5. **Asset-route hardening still latent.** `src/http/middleware/path-canonical.ts` ships exported but mounted as no-op (per spec §3.4). When Phase 4 introduces attachment-serving routes, that mount must be wired. The test file `path-canonical.test.ts` covers the function in isolation but cannot exercise route integration until then. Carry into Phase 4 spec backlog.

6. **CLI `SUBSTRATE_PORT_OVERRIDE` is a test-only escape hatch.** Plan §4 Step 7 caveat noted it must be removed or hidden before v1 ships. Tracked here so Phase 6 (or earlier UX-hardening phase) cleans it up.

7. **Cosmetic: plan-doc status text.** Plan header still reads `Status: Revised v1.1 (post Architect Reviewer pass — ready for development)`. Once the PR merges, Orchestrator should flip to `Status: Complete` (per workflow.md checklist Stage 5 "Plan document status updated (Planned → Complete)"). Not a gate; mentioned for completeness.

## Verdict

**CONCERN — fixable in seconds.**

Phase 1 substantively meets every spec §8 acceptance criterion and the Phase Completion Checklist, with one mechanical exception: `prettier --check` fails on `tests/manual/run-smoke.mjs`. That single file needs `prettier --write` before the PR can be created (Stage 3 hard requirement).

Once that one-line/two-line formatting commit lands, Phase 1 is **ready to merge**. All four workflow hard gates are satisfied, 127 tests + 60 s concurrency smoke + manual MCP-client smoke all pass, build is clean, types are clean, lint is clean.

Recommended next actions (Orchestrator):
1. Run `pnpm exec prettier --write tests/manual/run-smoke.mjs` → amend HEAD (or add `style:` commit).
2. Optional but recommended: log the React 19 / Vite 8 / TS 6 resolved-version deviation in `decisions.md` and update PRD §7 → React 19.
3. Flip plan status to Complete, create PR, tag `phase-01-complete` after merge.
