# Phase 3 Audit — Policy Engine + Envelope

**Date:** 2026-06-01
**Auditor:** Assistant agent (separate from authors and reviewers)
**Branch:** `feature/phase-03-policy-engine`
**HEAD:** `e1ff7ec` — `test: policy-engine bootstrap-flow + smoke updates; acceptance 0.0.3 (Step 7)`
**Commits this phase produced:** 7 on top of `main` (tag `phase-02-complete`), plus the spec/plan doc commit.

## Summary table

| Category | Status |
|---|---|
| Stage 1 — Spec | DONE (approved 2026-06-01; §3.0 decisions locked; §8 recommendations all confirmed) |
| Stage 2 — Planning | DONE (Architect Reviewer v1.1, approve-with-changes, no BLOCKERs; C-1/C-3/C-5 incorporated) |
| Stage 3 — Development | DONE — all 7 steps committed; lint/format/types/build all clean |
| Stage 4 — QA | DONE — 331 unit+integration green; concurrency + manual smoke run separately, passing |
| Stage 5 — Phase-end | DONE with notes (one carryover test gap + accepted residuals recorded below) |

## Hard gates compliance (workflow.md §"Hard Gates")

| # | Gate | Evidence |
|---|---|---|
| 1 | No plan without an approved spec | `.agents/plans/specs/phase-03-spec.md` — `Status: APPROVED (Diego, 2026-06-01)`. |
| 2 | No development without an approved plan | `.agents/plans/phase-03-policy-engine.md` — `Status: Reviewed v1.1 … ready for development`. |
| 3 | No commits without code review | Per-phase cadence. One whole-phase Code Reviewer pass produced the Step 6 NIT fix `1abccdc` `docs(policy): note substring ops no-match on array fields`. (No BLOCKERs/CONCERNs surfaced — only the one doc NIT.) |
| 4 | No PR without Assistant audit | This document, written by an agent separate from the authors. |

All four hard gates are satisfied.

## Commit list (`main..HEAD`)

```
e1ff7ec test: policy-engine bootstrap-flow + smoke updates; acceptance 0.0.3 (Step 7)
1abccdc docs(policy): note substring ops no-match on array fields (Step 6 review NIT)
d3251d6 feat(mcp): wire policy engine into task writes; whoami hint; reverse_captcha stub (Step 5)
7515fd5 feat(policy): engine orchestration (guards block, responsibilities suggest) (Step 4)
66b1b30 feat(policy): transition-guard + agent-responsibility classes (Step 3)
2ad2a0e feat(policy): condition-tree evaluator + field resolution (Step 2)
89cbf68 feat(policy): operators + condition types (Step 1)
```

One commit per plan Step (1–5), the Step 6 review-fix commit, and the Step 7 acceptance commit. (`a40bef5 docs: Phase 3 spec + plan` precedes the branch work.) Note: Step 4–7 work landed in fewer commits than the plan's projected commit names (e.g. the bootstrap-flow test, smoke updates, and `0.0.3` bump all rode `e1ff7ec`), and no standalone `fix(review)` commit was needed since the single review produced only a doc NIT. Cosmetic deviation from the plan's commit-naming, no impact on content.

## Spec §7 acceptance criteria

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | transition_guard fixture: failing guard → `transition_blocked` with configured message; task unchanged (tx rolled back, no `updated` event) | PASS | `mcp-bootstrap-flow.test.ts`: move todo→in_progress without `repro_steps` → `error.code === 'transition_blocked'`, message `'Set repro_steps before moving to In Progress.'`; `get_task` after block → `version === 1`, `group_id === 'todo'`; `get_task_history` → exactly `['created','updated']` (the block emitted nothing). Mirrored at the tool level in `update-task.test.ts` ("blocks a guarded transition and rolls back (no version bump, no event)"). |
| 2 | agent_responsibility fixture: matching writes include the policy in `policies_fired` with its message | PASS | Integration: create with auth-y title → `policies_fired` contains `resp-auth` with its `message`. Tool level: `create-task.test.ts` "surfaces a matching agent_responsibility on create"; `update-task.test.ts` "surfaces a matching agent_responsibility on update (post-write state)". |
| 3 | Mixed policies fire in priority order; `policies_fired` includes only engaged policies | PASS | `engine.test.ts`: responsibilities returned in `priority` order (`['b','a']` for priorities 0,1); guards sorted asc and only engaged ones returned; "group change to a group with no matching guard proceeds with no guard entries" (`update-task.test.ts`). |
| 4 | `whoami` returns the easter-egg hint; `phase` updated | PASS | `whoami.ts`: `hints: [REVERSE_CAPTCHA_HINT]`, `PHASE_STRING = 'v0.0.3 (policy engine + envelope)'`. Integration asserts the exact hint string (`bootstrap-flow.test.ts:317`). |
| 5 | `reverse_captcha` stub returns the placeholder | PASS | `reverse-captcha.ts` returns `{ error: 'Coming in v0.1.0', about: { built_by: 'Diego Ferreyra', site: 'https://diegoferreyra.com' } }`; registered as last read tool in `registry.ts` (`registerReverseCaptcha`); exercised in the integration flow and manual smoke. |
| 6 | `pnpm test` green; `tsc --noEmit` (root+ui), `eslint`, `prettier`, `pnpm build` clean | PASS | See Test results below. **331 tests, 46 files, 0 failures.** All static gates exit 0. |
| 7 | `pnpm test:smoke:concurrency` + `node tests/manual/run-smoke.mjs` green | PASS (run separately) | Not re-run in this audit per instruction; Diego ran both green this session. Both are correctly wired: concurrency worker present; manual runner now exercises a guard block (`transition_blocked`) and a `reverse_captcha` call (`run-smoke.mjs:161,302–309`). |
| 8 | Every write that ran policies did so within the Phase 2 tx-ownership model (guards inside the tx; no engine-owned tx) | PASS | `engine.ts` opens no transaction (plain functions). `update-task.ts`: `runTransitionGuards` is called inside `withTransaction`, before `updateTask`; `board` + guard entries are hoisted out of the closure for the post-commit `runAgentResponsibilities`. `create-task.ts` runs responsibilities after the tx commits. |
| 9 | `BINARY_VERSION` → `0.0.3` | PASS | `src/core/version.ts`: `BINARY_VERSION = '0.0.3'`; `package.json` version `0.0.3`. `BINARY_SCHEMA_VERSION` stays `2` (no migration), as specified. |

## Spot-checked correctness claims

- **Guards inside the tx, before `updateTask`; candidate is `{...existing, ...patch}`.** Confirmed in `update-task.ts:96–105`: `const candidate: Task = { ...existing, ...patch }`, wrapped as `{ task: candidate }`, passed to `runTransitionGuards` inside the `withTransaction` callback before the `updateTask` call. A thrown `transition_blocked` rolls back the whole write (integration asserts version unchanged + no `updated` event).
- **Guards fire only on a real group change.** Condition is `input.group_id !== undefined && input.group_id !== existing.group_id` — not merely "present" (`update-task.ts:97`). `update-task.test.ts` "does not evaluate guards when there is no group change (even with a failing require)" covers this.
- **Responsibilities run after commit on create + update; engine opens no tx.** `create-task.ts:114` and `update-task.ts:143` both call `runAgentResponsibilities` outside/after the `withTransaction`. `engine.ts` has no `withTransaction`/`execute` reference.
- **Operators never throw; `matches_regex` capped/guarded.** `operators.ts`: header documents the no-throw invariant; `matches_regex` rejects non-string / `>1000`-char patterns and wraps `new RegExp(...).test(...)` in try/catch → `false`. Numeric ops coerce via `num()` (finite-or-NaN) so non-numeric operands no-match. `operators.test.ts` asserts invalid + oversized regex → false, `Infinity`→no-match.
- **Evaluator literal-then-custom_data fallback.** `resolveField` walks the literal path first, falls back to `<root>.custom_data.<rest>` unless the path already targets `custom_data`; unresolvable → `undefined`. `evaluator.test.ts` covers literal hit, fallback (`task.priority`→`custom_data.priority`), explicit-custom_data (no fallback), and unresolvable→undefined.
- **Malformed-definition handling.** `parseGuardDefinition` returns `null` (does-not-engage) when `from_group`/`to_group` aren't strings; non-array `require` → `[]` (passes trivially). `parseResponsibilityDefinition` returns `null` (does-not-fire) when `message` is missing/empty/non-string; non-array `when` → `[]` (always matches). `engine.ts` skips `null` parses. `engine.test.ts` "skips disabled, archived, and message-less responsibilities" and the default-message case cover these.
- **`version_mismatch` still doesn't leak `current_version`.** All six throw sites in `tasks.ts` pass only `{ id }`; repo comment reaffirms "NO `current_version` in details." `update_task` adds nothing to this path. No regression.

## Test results

| Suite | Files | Tests | Duration | Result |
|---|---|---|---|---|
| `pnpm test` (unit + integration) | 46 | **331** passed | 17.07 s | green |
| `pnpm test:smoke:concurrency` (60 s) | — | — | — | run separately this session, passing |
| `pnpm exec tsc --noEmit` (root) | — | — | — | clean (exit 0) |
| `pnpm --dir ui exec tsc --noEmit` | — | — | — | clean (exit 0) |
| `pnpm exec eslint .` | — | — | — | clean (exit 0) |
| `pnpm exec prettier --check .` | — | — | — | clean ("All matched files use Prettier code style!", exit 0) |
| `pnpm build` | — | — | — | clean (UI 192 KB JS / 8.3 KB CSS, exit 0) |
| Manual MCP-client smoke (`run-smoke.mjs`) | — | — | — | run separately this session, passing |

331 passing exceeds the ~331 target; +64 over Phase 2's 267.

## Coverage notes (tested vs. gaps)

**Well covered.** Every Phase 3 module ships a co-located `*.test.ts`: `operators`, `evaluator`, `transition-guard`, `agent-responsibility`, `engine`, plus the two write tools (`create-task`, `update-task`), `whoami`, `reverse-captcha`, and the bootstrap-flow integration. The spec §5 edge-case table maps cleanly to tests:

| Spec §5 case | Covered by |
|---|---|
| update_task with no group change → no guards run | `update-task.test.ts` (failing require, no group change → not evaluated) |
| group change, no matching guard → proceeds, no entries | `update-task.test.ts` "group change to a group with no matching guard" |
| guard `require` missing field via `exists` → fail → blocked | integration (repro_steps absent) + `update-task.test.ts` block case |
| guard passes → listed (no message) | `update-task.test.ts` "passes a guarded transition … and lists it"; `engine.test.ts` |
| disabled / archived policy skipped | `engine.test.ts` (both guards and responsibilities) |
| `matches_regex` invalid/oversized → no-match, no crash | `operators.test.ts` |
| empty `when` on a responsibility → always matches | `agent-responsibility.test.ts` |
| numeric op (`gt`) on non-numeric field → no-match, no throw | `operators.test.ts` |
| two guards engage, first fails → blocked from first, second not evaluated | `engine.test.ts` "stops on the first failing guard" |
| responsibility on create matching `when` → fires | `create-task.test.ts` |
| field-ref literal vs custom_data fallback | `evaluator.test.ts` |

Plus the C-1/N-2 candidate-state nuance: `update-task.test.ts` exercises group change + custom_data change in one call (guard sees the NEW value). The "group change with NO custom_data change resolves EXISTING custom_data" branch is logically covered by the same candidate formula (`{...existing, ...patch}` carries `existing.custom_data` when `custom_data` is untouched) and the integration flow's final move (which sets repro_steps in the same call) — but there is **no dedicated test for the "group-only change, require reads an existing custom_data field" path** in isolation (gap 1 below).

**Gaps / thin spots (none blocking):**

1. **No isolated test for "group-only change where `require` reads a pre-existing custom_data field."** The plan (Step 5, N-2/C-1) called for both branches: (a) group + custom_data change in one call — present and tested; (b) group change with NO custom_data change still resolving an existing custom_data field in `require` — only covered transitively by the candidate-state construction, not by a standalone assertion. The code is correct (`candidate = {...existing, ...patch}` preserves `existing.custom_data` when untouched), so risk is low, but the explicit (b) test the plan named is missing. Worth a one-line follow-up test.
2. **`unarchive_task` still has no standalone tool-level `*.test.ts`** — a carryover from the Phase 2 audit (gap 1 there). Phase 3 did not touch this tool and did not add the follow-up test. Still covered transitively (repo tests + integration archive→unarchive). Non-blocking; same low-risk status as before.
3. **Concurrency + manual smoke not re-executed in this audit** — accepted on Diego's word that both ran green this session (per instruction). Both are correctly wired (manual runner now includes a guard-block + `reverse_captcha` assertion; concurrency worker unchanged from Phase 2). This audit did not independently observe them green.

## Scope deviations from spec

1. **`validation` and `automation` policy classes are out of v1** — by design (spec §2 "Out of scope"). The design doc lists four classes; v1 ships two (`transition_guard`, `agent_responsibility`). No policy mutates state. Confirmed: the engine only reads/evaluates; `runAgentResponsibilities` produces suggestions, never writes. **Accepted / intentional.**
2. **Comment writes do not trigger policy evaluation** — by design (spec §2): the only comment-triggered class (`automation`) is out of v1. `add_comment`/`edit_comment`/`archive_comment` are unchanged. **Accepted / intentional.**
3. **Step 4–7 commit consolidation.** The plan §4 projected separate commits (`test: …`, `chore(phase-03): … 0.0.3`, `docs(phase-03): assistant audit`) and a `fix(review)` commit. In practice the bootstrap-flow test, smoke updates, and the `0.0.3` bump rode a single `e1ff7ec`, the review produced only a doc NIT (`1abccdc`, not a `fix(review)`), and this audit lands separately. Cosmetic deviation from the plan's commit choreography; all content is present. **Accepted.**
4. **Markdown sanitizer (`src/shared/sanitize.ts`), deferred from Phase 2 "for the first real consumer (Phase 3 `agent_responsibility` rendering)," did NOT ship in Phase 3.** Confirmed absent. Responsibility `message` strings are author-supplied substrate and are returned verbatim in `policies_fired[].message` with no sanitization. For a local single-user tool with no HTML rendering in the MCP path this is benign, but the Phase-2 audit explicitly named Phase 3 as the sanitizer's first consumer — that expectation slipped. See residual risk 2. **Noted deviation; non-blocking for v1 scope, flag for the UI phase (Phase 5).**

## Residual risks / deferrals

1. **ReDoS via `matches_regex` — accepted residual.** `value` is capped at 1000 chars and compile+test is wrapped in try/catch → no-match-on-throw, but there is no execution-time/ReDoS sandbox. A pathological-but-short pattern on a long field could still pace the single-threaded server. Accepted for a local single-user tool (spec R-1, plan R3).
2. **Responsibility `message` is unsanitized** (see deviation 4). Safe in the MCP/JSON path today; becomes relevant when Phase 5's HTML UI renders `policies_fired[].message`. Defer sanitization to the first HTML-rendering consumer.
3. **`eq`/`neq` and absent-field vacuous truth.** `resolveField` returns `undefined` for an unresolvable path; `eq` against a condition whose `value` is also `undefined` (`jsonEqual(undefined, undefined)`) returns `true`, and `neq` correspondingly `false`. Substrate authors writing `{ field: 'task.x', op: 'eq' }` with no `value` get vacuous matches. This mirrors the intended "never throw, degrade to a boolean" design and structural validation is expected to catch value-less leaves at load, but the operator layer itself does not guard against a value-less `eq`. Documented as an accepted edge; low risk.
4. **Guard `require` evaluation lengthens the write tx.** Guards now run inside `withTransaction` before `updateTask`, adding pure-CPU evaluation to the transaction window. v1 evaluation is trivial (small condition trees over in-memory objects), and the 60 s concurrency smoke passed, but this extends the Phase-2 "longer-transaction profile" note — keep an eye on contention if substrate authors write large policy sets.
5. **Coverage gap 1 (group-only change resolving existing custom_data in `require`)** and **gap 2 (`unarchive_task` standalone test)** — small non-blocking follow-ups.

## Verdict

**SHIP — go for fast-forward merge to `main` + tag `phase-03-complete`.**

Phase 3 substantively meets every spec §7 acceptance criterion. All locally-run gates are clean: **331 tests green** (46 files, 0 failures), root + ui `tsc` clean, eslint clean, prettier clean, build clean. `BINARY_VERSION` is `0.0.3`, `BINARY_SCHEMA_VERSION` stays `2` (no migration, as specified). The two smoke suites were run separately by Diego this session and pass; both are correctly wired (manual smoke gained a guard-block + `reverse_captcha` assertion). All four workflow hard gates are satisfied.

Spot-checks confirm the load-bearing correctness claims: transition guards evaluate **inside** the write transaction against the `{...existing, ...patch}` candidate and roll the write back atomically on a block (no version bump, no `updated` event); guards fire only on a real group change; responsibilities run after commit; the engine opens no transaction (Phase 2 lock preserved); operators never throw and `matches_regex` is length-capped and exception-guarded; the evaluator's literal-then-custom_data fallback is correct; and `version_mismatch` still leaks no `current_version`.

The gaps are cosmetic/low-risk: a missing isolated test for the group-only-change-reads-existing-custom_data branch (correct by construction, covered transitively), the still-absent `unarchive_task` standalone test (carryover), and the sanitizer that was nominally expected here but is benign until the HTML UI phase. Accepted residuals (ReDoS, eq-with-absent-value vacuous truth) are consistent with the spec's locked decisions.

Recommended next actions (Orchestrator):
1. Optionally add the two follow-up tests (group-only candidate-state branch; `unarchive_task` tool test) — non-blocking.
2. Track the responsibility-`message` sanitizer as a Phase 5 (UI) prerequisite.
3. Flip plan status to `Complete`.
4. Fast-forward merge to `main`, tag `phase-03-complete`.
