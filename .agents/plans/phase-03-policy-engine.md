# Phase 3 Plan — Policy Engine + Envelope

**Status:** Reviewed v1.1 (Architect Reviewer: approve-with-changes, no BLOCKERs) — ready for development
**Author:** Architect (revised after review)
**Last updated:** 2026-06-01
**Review notes:** Incorporated C-1 (pin candidate-state formula + test), C-3 (malformed-`definition` handling is a hard requirement with tests — `definition` is fully unstructured at load), C-5 (hoist `board` + guard entries out of the `update_task` tx closure for the post-commit responsibility pass), plus doc tightenings C-2/C-4/C-6 and nits N-1/N-2/N-4.
**Spec:** [`specs/phase-03-spec.md`](specs/phase-03-spec.md) (APPROVED 2026-06-01)
**Architecture plan:** [`v1-architecture.md`](v1-architecture.md) §5 Phase 3
**Workflow:** [`../workflow.md`](../workflow.md)
**Feature branch:** `feature/phase-03-policy-engine`

---

## 1. Overview

The *what* is in the spec. This plan is the *how*: file-by-file work, order, dependencies, test mapping, the single per-phase Code Reviewer gate, and merge strategy.

Phase 3 adds the `src/policy/` module (operators → evaluator → two policy classes → engine), wires it into the two task-write handlers (`create_task`, `update_task`), populates `policies_fired`, lights up the `whoami` hint, and ships the `reverse_captcha` stub. **No SQLite schema change, no migration** — policies are already parsed/validated substrate (Phase 2). `BINARY_SCHEMA_VERSION` stays `2`; `BINARY_VERSION` → `0.0.3` at acceptance.

**7 steps**, **ONE Code Reviewer pass for the whole phase** (Step 6), per the per-phase review cadence (decided 2026-05-28). Per-step "Reviewer focus" notes concentrate that single review.

## 2. Branching & merge strategy

- Create `feature/phase-03-policy-engine` from `main` (tag `phase-02-complete`).
- Commit per step. One Code Reviewer pass (Step 6) over `git diff main...HEAD` before merge.
- Fast-forward merge to `main`, no squash, tag `phase-03-complete`.
- **No dev-DB footgun this phase** — no schema bump, so a `main`-built binary still opens a branch-dev `data.sqlite`.

## 3. Dependencies

No new runtime deps. Pure TypeScript evaluation over already-loaded substrate. `matches_regex` uses the built-in `RegExp` with a length cap (no regex library).

## 4. Implementation order

### Step 1 — Operators + condition types (Backend Engineer)

Foundation. Pure functions, no I/O, no substrate.

Create:
- `src/policy/types.ts` — `LeafOperator` union, `LeafCondition`, `Condition` (leaf | `all_of` | `any_of` | `none_of`), `EvalContext` (per spec §3.2).
- `src/policy/operators.ts` — the full locked set (spec §3.1): existence (`exists`, `not_exists`, `is_empty`, `not_empty`), equality (`eq`, `neq`), sets (`in`, `not_in`), numeric (`gt`, `gte`, `lt`, `lte`), string (`contains`, `not_contains`, `starts_with`, `ends_with`, `matches_regex`, `matches_any_keyword`), array (`has_any`, `has_all`). One exported `applyOperator(op, fieldValue, cond)` dispatch + per-op helpers. Never throws (type-mismatch → `false`). `matches_regex`: length cap (1000), guarded compile+test, throw/invalid → `false` (R-1).

Tests:
- `operators.test.ts` — each operator: true/false cases, empties, type-mismatch no-match, null/undefined handling, `matches_regex` invalid + oversized → false, `matches_any_keyword` case-insensitivity.

_Reviewer focus (Step 6):_ no-throw guarantee on every operator; regex length cap + guarded compile; `is_empty`/`not_empty` cover `''`/`[]`/`{}`/null/undefined.

Commit: `feat(policy): operators + condition types (Step 1)`.

### Step 2 — Evaluator + field resolution (Backend Engineer)

Create:
- `src/policy/evaluator.ts` — `resolveField(path, ctx)` (literal-first, then `custom_data` fallback — spec §3.2; documented examples in the header), `evaluateCondition(cond, ctx)` (leaf via operators; compound recursion), `evaluateConditions(conds, ctx)` (implicit `all_of`). Empty `all_of` → true, empty `any_of` → false, empty `none_of` → true.
  - **C-2:** `resolveField` is the FIRST implementation of the literal-then-`custom_data` rule. The arch plan (§Phase 2) *decided* the rule, but no Phase 2 code implements it (`list_tasks` uses bound `$.key` JSON paths — a different mechanism). So this is net-new code with no reference to mirror; it gets first-class test coverage, not "port" treatment.

Tests:
- `evaluator.test.ts` — leaf dispatch; compound `all_of`/`any_of`/`none_of` incl. empties + nesting; field-ref worked examples (`task.priority` literal vs `task.custom_data.priority` fallback; `task.custom_data.x` literal; unresolvable → undefined → `exists` false); never throws on a malformed tree.

_Reviewer focus:_ field-ref fallback correctness + precedence (literal wins); compound short-circuit and empty-set semantics; recursion depth is bounded by substrate structure (no user-supplied unbounded recursion at eval time — trees come from parsed JSON).

Commit: `feat(policy): condition-tree evaluator + field resolution (Step 2)`.

### Step 3 — Policy classes (Backend Engineer)

Create:
- `src/policy/transition-guard.ts` — `TransitionGuardDef` type guard/parser over `policy.definition` (`from_group`, `to_group`, `require?`, `on_failure_message?`); `guardEngages(def, fromGroup, toGroup)` (with `'*'` wildcard); `evaluateGuard(def, candidate)` → pass/fail.
- `src/policy/agent-responsibility.ts` — `AgentResponsibilityDef` (`when?`, `message`); `responsibilityMatches(def, state)` (empty `when` ⇒ true).

Both filter out `enabled: false` / `archived_at != null` at the engine layer (Step 4), not here — these modules are pure predicate/parse helpers.

**C-3 — malformed `definition` is a HARD requirement, not a nicety.** `PolicySchema.definition` is `z.record(z.string(), z.unknown())` and the Phase 2 validator only checks `from_group`/`to_group` group-*existence* for guards. Every other `definition` field the engine reads is `unknown` and could be any JSON. The parse helpers must define and TEST these behaviors:
- `from_group`/`to_group` not strings → guard does not engage (no crash).
- `require` absent → guard passes trivially (empty all_of ⇒ true). `require` present but **not an array** → treat as no conditions (passes); do not crash.
- `on_failure_message` absent or non-string → use the default block message (Step 4 N-4).
- `when` absent → responsibility always matches (spec). `when` present but not an array → treat as no conditions (matches).
- `message` missing or non-string on a responsibility → the policy does NOT fire (it cannot produce a usable suggestion); never crash envelope assembly.

Tests:
- `transition-guard.test.ts` — engagement matrix incl. `'*'` from/to, non-matching transitions, pass/fail of `require`, non-string from/to → no engage, non-array `require` → passes, absent `require` → passes.
- `agent-responsibility.test.ts` — when-match, empty-when always matches, non-array `when` → matches, missing/non-string `message` → does not fire.

_Reviewer focus:_ `'*'` wildcard both sides; the full malformed-`definition` matrix above (real crash surface — `definition` is unstructured at load); guard evaluates against candidate (post-merge) state.

Commit: `feat(policy): transition-guard + agent-responsibility classes (Step 3)`.

### Step 4 — Engine orchestration (Backend Engineer)

Create:
- `src/policy/engine.ts` — per spec §3.5:
  - `runTransitionGuards({ board, fromGroup, toGroup, candidate }): PolicyFiredEntry[]` — filter board.policies to enabled, non-archived `transition_guard`s; sort by `priority` asc then `created_at`; for each that engages, evaluate; **first failure throws `SubstrateError.transitionBlocked(on_failure_message ?? default, { policy_id, from_group, to_group })`**; passed engaged guards accumulate as `PolicyFiredEntry` (no `message`). Returns the passed entries.
  - `runAgentResponsibilities({ board, state }): PolicyFiredEntry[]` — filter to enabled, non-archived `agent_responsibility`; sort by priority/created_at; matched → entry with `message`.
  - A small `toPolicyEntry(policy, extra?)` helper builds `{ policy_id, policy_name, policy_type, description?, message? }`.
  - **N-4 default block message:** when `on_failure_message` is absent/non-string, use a concrete default the test can assert, e.g. `` `Policy '${policy.name}' blocks moving from '${from_group}' to '${to_group}'.` ``

Tests:
- `engine.test.ts` — guards: ordering, stop-on-first-failure (later guard not evaluated), passed-listed, disabled/archived skipped, no-engage → empty. Responsibilities: ordering, matched messages, disabled/archived skipped. Default block message when `on_failure_message` absent.

_Reviewer focus:_ engine opens NO transaction (handler-owns-tx lock); priority+created_at ordering; stop-on-first-failure; disabled/archived exclusion in BOTH paths; entry shape matches `PolicyFiredEntry`.

Commit: `feat(policy): engine orchestration (guards block, responsibilities suggest) (Step 4)`.

### Step 5 — Handler integration + whoami + reverse_captcha (Backend Engineer)

Modify:
- `src/mcp/tools/write/update-task.ts` — inside the existing `withTransaction`, after custom_data merge + field_schema validation and **before** `updateTask`: if the group is changing, run guards; a throw rolls back (no version bump, no `updated` event). After commit, run responsibilities. Assemble `guardEntries.concat(responsibilityEntries)` into the envelope.
  - **C-1 — candidate-state formula (pin exactly):** build the row the update *would* produce and wrap it as the `EvalContext`:
    ```
    const candidate = { ...existing, ...patch }; // patch already carries title/description/group_id and custom_data:merged when touched
    // guard require reads candidate.custom_data.<field> via the literal-then-custom_data resolver
    runTransitionGuards({ board, fromGroup: existing.group_id, toGroup: input.group_id!, candidate: { task: candidate } });
    ```
    Seed from `existing` (NOT from `patch` alone — `patch` omits untouched fields). `merged` is the full post-merge custom_data; it lands in `candidate.custom_data` only when `input.custom_data !== undefined`, otherwise `candidate.custom_data === existing.custom_data` (correct — untouched). A group-change with NO custom_data change must still resolve existing `custom_data` fields in `require` (test this — N-2/C-1).
  - **C-5 — hoist out of the closure:** `board` is resolved *inside* the tx in the current handler. Return `board` and the passed-guard entries OUT of the `withTransaction` callback (e.g. `const { task, board, guardEntries } = await withTransaction(...)`) so the post-commit `runAgentResponsibilities({ board, state: { task } })` and envelope assembly can see them. Do not call responsibilities inside the tx.
  - **C-4 — envelope wiring:** both handlers now pass a **second positional arg** to `successEnvelope(applied, policiesFired)` (today they call it with one arg). Do not fold policies into `applied`.
  - **C-6 — invariant:** the existing board-missing → `not_found` throw and any `loadSubstrate` throw remain inside the tx and still roll back via the existing catch; adding guards does not change that.
- `src/mcp/tools/write/create-task.ts` — `loadSubstrate`/`board` already resolve *before* the tx, so `board` is in scope post-commit. After commit, `runAgentResponsibilities({ board, state: { task } })`; pass entries as the second arg to `successEnvelope`. (No guards — not a transition.)
- `src/mcp/tools/read/whoami.ts` — `hints: ["Try the reverse_captcha tool — small puzzle for agents only."]`; `PHASE_STRING` → `v0.0.3 (policy engine + envelope)`.
- `src/mcp/tools/read/reverse-captcha.ts` (new) — input `{}`; returns `{ error: "Coming in v0.1.0", about: { built_by: "Diego Ferreyra", site: "https://diegoferreyra.com" } }`; routed through `wrapToolHandler`.
- `src/mcp/registry.ts` — **N-1:** append `reverse_captcha` to the read-tools block (last read, before the writes), consistent with the registry's reads-then-writes ordering.

Tests:
- `update-task.test.ts` extend — guard block → `transition_blocked`, no version bump, no `updated` event (tx rolled back); guard pass → listed in `policies_fired`; group-change with no matching guard → proceeds, no entries; responsibility match on update → entry present; no-group-change update with guards present → no guard eval; **N-2/C-1: group change + custom_data change in the same call → guard `require` sees the NEW custom_data value; group change with NO custom_data change → guard `require` still resolves the EXISTING custom_data value.**
- `create-task.test.ts` extend — responsibility match on create → entry present; no guards ever run on create.
- `reverse-captcha.test.ts` (new) — placeholder response shape.
- `whoami.test.ts` extend — hint present; phase string updated.

_Reviewer focus:_ guards strictly inside the tx (block rolls back atomically); responsibilities after commit; candidate-state correctness for guard `require`; group-change detection (`!== existing.group_id`, not just `!== undefined`); envelope assembles guard + responsibility entries; create_task never runs guards.

Commit: `feat(mcp): wire policy engine into task writes; whoami hint; reverse_captcha stub (Step 5)`.

### Step 6 — 🛑 Code Reviewer pass (whole phase)

One Code Reviewer over `git diff main...HEAD`, using the per-step Reviewer-focus notes. Concentrate on:
- Operators (Step 1): no-throw, regex guard.
- Evaluator (Step 2): field-ref fallback, compound/empty semantics.
- Classes (Step 3): wildcard matching, malformed-definition defense.
- Engine (Step 4): no engine-owned tx, ordering, stop-on-first-failure, disabled/archived exclusion.
- Integration (Step 5): guards inside tx (atomic rollback on block), candidate state, create-has-no-guards, envelope assembly.

Fix BLOCKERs + CONCERNs in a follow-up `fix(review)` commit.

Commit: `fix(review): address Phase 3 Code Reviewer findings (Step 6)` (only if findings).

### Step 7 — Acceptance + integration + audit + merge (Backend Engineer → Assistant)

- Extend `tests/integration/mcp-bootstrap-flow.test.ts` with the spec §4 fixture: a board carrying a `transition_guard` (todo→in_progress requires `repro_steps`) and an `agent_responsibility` (title matches auth keywords). Assert: create with auth-y title → responsibility in `policies_fired`; update to in_progress without repro_steps → `transition_blocked` + task unchanged; add repro_steps + retry → success, guard listed, responsibility still fires.
- Acceptance gate: `pnpm build`, `pnpm test`, `tsc --noEmit` (root+ui), `eslint`, `prettier`, `pnpm test:smoke:concurrency`, `node tests/manual/run-smoke.mjs` (extend with a guard-block assertion + a `reverse_captcha` call). Bump `BINARY_VERSION` → `0.0.3`.
- Spawn Assistant → `.agents/audits/phase-03-audit.md`. Resolve gaps.
- Fast-forward merge to `main`, tag `phase-03-complete`.

Commits: `test: policy-engine bootstrap-flow + smoke updates (Step 7)`, `chore(phase-03): acceptance pass + 0.0.3 (Step 7)`, `docs(phase-03): assistant audit (Step 7)`.

## 5. Test mapping (spec §6 → plan)

| Spec test requirement | Plan location |
|---|---|
| operators unit | Step 1 |
| evaluator + field-ref | Step 2 |
| transition-guard class | Step 3 |
| agent-responsibility class | Step 3 |
| engine orchestration | Step 4 |
| update_task guard block/pass + responsibility | Step 5 |
| create_task responsibility | Step 5 |
| reverse_captcha + whoami hint | Step 5 |
| bootstrap-flow e2e | Step 7 |

## 6. Risks

- **R1 (field-ref edge cases, R-P3-1):** literal-vs-fallback precedence. Mitigation: worked examples in evaluator header + a test per example (Step 2).
- **R2 (cumulative state, R-P3-2):** v1 has no automation, so policies never mutate. Guard `require` sees candidate state; responsibilities see post-write state. Both covered in Step 5 tests.
- **R3 (ReDoS via `matches_regex`):** length cap + guarded compile + no-match-on-throw (Step 1). Accepted residual risk (local single-user tool).
- **R4 (guard atomicity):** a blocked guard must roll back the whole write. Mitigation: guards evaluated *inside* `withTransaction` before `updateTask`; Step 5 test asserts no version bump + no event after a block. Code Reviewer verifies (Step 6).
- **R5 (tx-ownership regression):** engine must not open its own tx. Mitigation: engine exposes plain functions; handler calls them. Reviewer verifies.

## 7. Definition of Done

- All step commits on `feature/phase-03-policy-engine`.
- Single whole-phase Code Reviewer pass done; BLOCKER/CONCERN findings resolved.
- Spec §7 acceptance criteria met.
- Assistant audit clean.
- Fast-forward merge to `main`, tag `phase-03-complete`.
