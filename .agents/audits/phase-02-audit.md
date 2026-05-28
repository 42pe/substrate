# Phase 2 Audit — Storage + Reads + Writes

**Date:** 2026-05-28
**Auditor:** Assistant agent (separate from authors and reviewers)
**Branch:** `feature/phase-02-storage-reads-writes`
**HEAD:** `669add4` — `chore(phase-02): final acceptance pass (Step 9)`
**Commits this phase produced:** 10 on top of `main` (tag `phase-01-complete`)

## Summary table

| Category | Status |
|---|---|
| Stage 1 — Spec | DONE (approved 2026-05-28; 20 recommended decisions + 4 open questions resolved §6) |
| Stage 2 — Planning | DONE (Architect Reviewer pass, v1.1; BLOCKER + concerns incorporated) |
| Stage 3 — Development | DONE — all 10 steps committed; lint/format/types/build all clean |
| Stage 4 — QA | DONE — 267 unit+integration green; concurrency + manual smoke run separately, passing |
| Stage 5 — Phase-end | DONE with notes (sanitizer + review-cadence deviations recorded below) |

## Hard gates compliance (workflow.md §"Hard Gates")

| # | Gate | Evidence |
|---|---|---|
| 1 | No plan without an approved spec | `.agents/plans/specs/phase-02-spec.md` — `Status: ✅ Approved 2026-05-28`. |
| 2 | No development without an approved plan | `.agents/plans/phase-02-storage-reads-writes.md` — `Status: Revised v1.1 (post Architect Reviewer pass — ready for development)`. |
| 3 | No commits without code review | Per-phase cadence (commit `6339763` codifies it). One whole-phase Code Reviewer pass landed as `034a9e3` `fix(review): address Phase 2 Code Reviewer findings (Step 8)`. |
| 4 | No PR without Assistant audit | This document, written by an agent separate from the authors. |

All four hard gates are satisfied.

## Commit list (`main..HEAD`)

```
669add4 chore(phase-02): final acceptance pass (Step 9)
034a9e3 fix(review): address Phase 2 Code Reviewer findings (Step 8)
9dbea2a test: full bootstrap-flow integration + concurrency/manual smoke updates (Step 7)
e25d55a feat(mcp): comment write tools — add/edit/archive with TaskEvents (Step 6)
486599c feat(mcp): task write tools — create/update/archive/unarchive with TaskEvents (Step 5)
0f414d9 feat(mcp): read tools, tool wrapper, loadSubstrate wiring (Step 4)
8cd7e54 feat(substrate): loader, validator, field-validator (Step 3)
224d111 feat(storage): task/comment/event repositories with OCC + filters (Step 2)
6339763 docs: code review cadence is per-phase, not per-step
b8f31dd feat(storage): migration 002, core types, envelope version nullable, pagination, withTransaction (Step 1)
```

One commit per plan Step (1–9), plus the cadence-doc commit. Step 10 (this audit + merge) is in progress.

## Spec §8 acceptance criteria

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | All v1-architecture §5 Phase 2 functional requirements implemented | PASS | Migration 002, repos (tasks/comments/events), substrate layer (loader/validator/field-validator/schemas), all 16 MCP tools, wrapper, deps wiring — all present and registered in `src/mcp/registry.ts`. |
| 2 | `pnpm test` green; ~250+ tests | PASS | **267 tests, 40 files, 0 failures**, 20.11s. Exceeds the ~250 floor. |
| 3 | `pnpm test:smoke:concurrency` green (task + event counts match) | PASS (run separately) | Not re-run in this audit per instruction; Diego ran it green this session. Worker INSERTs a `created` task_event per write (`concurrency-worker.mjs:83`) so the count-equality assertion is wired. |
| 4 | `pnpm exec tsc --noEmit` clean (root + ui) | PASS | Root exit 0; `pnpm --dir ui exec tsc --noEmit` exit 0. |
| 5 | `pnpm exec eslint .` + `pnpm exec prettier --check .` clean | PASS | eslint exit 0; prettier "All matched files use Prettier code style!" exit 0. (Fixes the one Phase-1 prettier gap.) |
| 6 | `pnpm build` clean | PASS | UI built (192 KB JS / 8.3 KB CSS), exit 0. |
| 7 | Real-MCP-client smoke (`node tests/manual/run-smoke.mjs`) passes full bootstrap flow | PASS (run separately) | Not re-run here per instruction; Diego ran it green. Script covers whoami → get_board_substrate → create_task → update_task → get_task_history (`run-smoke.mjs:124–264`). |
| 8 | `withTransaction` used by every write tool; no TaskEvent emitted outside the parent tx | PASS | All 7 write `.ts` files import + call `withTransaction`; `appendEvent` is called inside the `withTransaction` callback in each (verified by reading `update-task.ts`, grep across `write/`). Repos take an `Executor` and never open their own tx (handler-owns-tx discipline). |
| 9 | Every write error envelope follows §3.6 conventions; verified by integration assertions | PASS | `mcp-bootstrap-flow.test.ts` asserts `schema_violation` (bad severity), `version_mismatch` (stale), comment `version: null`. `version_mismatch` carries only `{ id }` — no `current_version` leak (`tasks.ts:172/200/238/245/268/275`). |
| 10 | Bootstrap flow works end-to-end against a SampleSaaS fixture board | PASS | `mcp-bootstrap-flow.test.ts:250` "runs the full bootstrap flow end-to-end against a real substrate" — whoami → substrate → create (valid+invalid) → update (+stale) → comment lifecycle → archive/unarchive → history ordering. |

## Spot-checked correctness claims

- **withTransaction + atomic TaskEvent** — confirmed in `update-task.ts`: `getTask`, `validateFieldSchema`, `updateTask`, and `appendEvent('updated')` all run inside one `withTransaction(deps.client, …)`. Same shape across the other six write tools.
- **`version_mismatch` never leaks `current_version`** — all six throw sites pass only `{ id }`; repo comment explicitly documents "NO `current_version` in details" (`tasks.ts:148`).
- **`list_tasks` binds JSON paths** — `json_extract(custom_data, ?)` everywhere; `missing_required_fields` binds `'$.'+key` as an arg with an explicit "never interpolate the field name into SQL" comment (`tasks.ts:432–435`). An injection test with a malicious field name (`"x') IS NULL OR (1=1"`) exists (`tasks.test.ts:300`).
- **`whoami` does no DB read** — only call is `deps.loadSubstrate()` (`whoami.ts:38`); no `deps.client`/`execute` reference. `PHASE_STRING = 'v0.0.2 (storage + reads + writes)'` per Q4.

## Test results

| Suite | Files | Tests | Duration | Result |
|---|---|---|---|---|
| `pnpm test` (unit + integration) | 40 | **267** passed | 20.11 s | green |
| `pnpm test:smoke:concurrency` (60 s) | — | — | — | run separately this session, passing |
| `pnpm exec tsc --noEmit` (root) | — | — | — | clean (exit 0) |
| `pnpm --dir ui exec tsc --noEmit` | — | — | — | clean (exit 0) |
| `pnpm exec eslint .` | — | — | — | clean (exit 0) |
| `pnpm exec prettier --check .` | — | — | — | clean (exit 0) |
| `pnpm build` | — | — | — | clean (exit 0) |
| Manual MCP-client smoke (`run-smoke.mjs`) | — | — | — | run separately this session, passing |

## Coverage notes (tested vs. gaps)

**Well covered.** Every Phase 2 module ships a co-located `*.test.ts`: migration 002, `withTransaction` (commit/rollback busy_timeout reapply, Error.cause), pagination cursor (string + number tiebreaker), all three repos, all three substrate modules, the wrapper, and one test file per MCP tool. The §5 edge-case table maps cleanly to tests:

- Stale version → `version_mismatch` (no `current_version`), archived-target conflict, board_id/parent_id rejection (wrapper), custom_data null-delete — covered (tasks repo + update-task tests + integration).
- Idempotent re-archive / re-unarchive (no version bump, no event) — covered (`archive-task.test.ts`, `tasks.test.ts`).
- `add_comment` parent-from-different-task conflict, comment-on-archived-task conflict — covered (`add-comment.test.ts`).
- `comment_edited` carries `before.body` for LWW forensics — covered (`edit-comment.ts:90`, edit-comment test).
- `missing_required_fields` requires `board_id`; SQL-injection-safe path — covered (`list-tasks.test.ts`, `tasks.test.ts:300`).
- Substrate strict-load failure modes, duplicate IDs, dangling/archived group refs — covered (loader + validator tests).

**Gaps / thin spots (none blocking):**

1. **`unarchive_task` has no standalone tool-level `*.test.ts`.** Coverage exists at the repo level (`tasks.test.ts`) and tool level via `archive-task.test.ts` + the integration flow (archive→unarchive version 3→4). The tool handler is a thin mirror of `archive-task`, so the risk is low, but the per-tool symmetry the plan §4 implies ("one `*.test.ts` per tool") is technically broken for this one tool. Worth a follow-up test for completeness.
2. **Concurrency + manual smoke not re-executed in this audit** — accepted on Diego's word that both ran green this session (per instruction). They are wired correctly (worker emits `created` events; manual runner walks the full bootstrap flow), but this audit did not independently observe them green.
3. **`policies` plumbed but inert.** `get_board_substrate` returns policies and the validator checks structural references, but no engine consumes them in Phase 2 — by design (Phase 3). Tests assert the empty/structural path only; there is no behavioral policy test because there is no behavior yet.

## Scope deviations from spec

1. **Markdown sanitizer (`src/shared/sanitize.ts`) deferred to Phase 3.** Spec §3.7 had it ship in Phase 2 "for forward-compat," but nothing in Phase 2 consumes it and `isomorphic-dompurify` pulls `jsdom` (install-risk). Plan §3 made this a deliberate, documented plan-level deviation ("minor, no re-approval needed"). Confirmed absent: no `src/shared/sanitize.ts`. First real consumer is Phase 3's `agent_responsibility` rendering. **Accepted.**
2. **Code review moved to per-phase cadence (one Step-8 pass) instead of per-step.** Codified in commit `6339763` and plan §1/§2 (per-step review was "amplifying scope"). One `fix(review)` commit (`034a9e3`) covers the whole-phase diff. **Accepted** — consistent with the revised workflow.
3. **Migration runner refactor to use `withTransaction` deferred** to optional v1.x cleanup (spec §6 decision 10, plan §3.3). The runner keeps its inline tx pattern, which `withTransaction` mirrors. **Accepted.**

## Residual risks / follow-ups (deferred to later phases)

1. **busy_timeout under longer transactions.** Phase 1 writes were single-statement; Phase 2 write handlers now do SELECT-for-merge + UPDATE + INSERT inside one tx. `withTransaction` reapplies `busy_timeout = 5000` in `finally`. The 60 s concurrency smoke passed, but the longer-transaction profile is new — keep an eye on contention if Phase 3 policy evaluation lengthens write tx duration.
2. **Dev-DB schema-bump footgun (plan §2).** `BINARY_SCHEMA_VERSION` is now 2; a `main`-built binary refuses a v2 `data.sqlite` (one-way forward migration). Tests use temp DBs and are unaffected; documented for developers switching branches.
3. **`add_comment` does not validate against `field_schema.comments` at the repo layer in all paths** — the comment field_schema is declared in types and returned by `get_board_substrate`, and `add-comment` runs validation, but comment-schema enforcement is lighter than task-schema (fewer fixtures exercise it). Low risk; revisit if Phase 3+ adds richer comment schemas.
4. **`unarchive_task` standalone test** (see Coverage gap 1) — small follow-up.

## Verdict

**SHIP — go for fast-forward merge to `main` + tag `phase-02-complete`.**

Phase 2 substantively meets every spec §8 acceptance criterion. All locally-run gates are clean: **267 tests green**, root + ui `tsc` clean, eslint clean, prettier clean (the one Phase-1 formatting blemish is resolved), build clean. The two smoke suites were run separately by Diego this session and pass; both are correctly wired. All four workflow hard gates are satisfied. Spot-checks confirm the load-bearing correctness claims: handler-owned transactions with atomic TaskEvent emission, no `current_version` leak on `version_mismatch`, bound JSON paths in `list_tasks` (with an injection test), and a pure-substrate `whoami`.

The only gaps are cosmetic/low-risk: a missing standalone `unarchive_task` tool test (covered transitively), and inert-by-design policy plumbing. Scope deviations (sanitizer → Phase 3, per-phase review cadence, runner-refactor deferral) are all documented and accepted.

Recommended next actions (Orchestrator):
1. Optionally add `unarchive-task.test.ts` for per-tool symmetry (non-blocking).
2. Flip plan status to `Complete`.
3. Fast-forward merge to `main`, tag `phase-02-complete`.
