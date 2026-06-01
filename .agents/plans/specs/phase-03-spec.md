# Phase 3 Spec — Policy Engine + Envelope

**Status:** APPROVED (Diego, 2026-06-01) — §3.0 decisions locked; §8 recommendations all confirmed.
**Author:** Spec Team
**Last updated:** 2026-06-01
**Architecture plan:** [`../v1-architecture.md`](../v1-architecture.md) §5 Phase 3
**Design doc:** [`../../substrate-initial-design-doc-20260508.md`](../../substrate-initial-design-doc-20260508.md) §Policy System
**Predecessor:** Phase 2 (`phase-02-complete`) — storage + reads + writes, all 16 tools, `policies_fired` always `[]`.

---

## 1. Goal

Make the substrate paradigm *enforceable* and *advisory*, end-to-end. Phase 2 returns `policies_fired: []` on every write. Phase 3 lights it up: the two v1 policy classes (`transition_guard`, `agent_responsibility`), the full locked operator set, a condition-tree evaluator with the established field-reference rule, and per-write orchestration that assembles a populated response envelope. Plus the `whoami` easter-egg hint and the stub `reverse_captcha` tool.

**No SQLite schema change in Phase 3.** Policies already live in substrate-as-code (`boards/*.json`), parsed and structurally validated in Phase 2. This phase only *reads* and *evaluates* them. `BINARY_SCHEMA_VERSION` stays at `2`; `BINARY_VERSION` bumps to `0.0.3` at acceptance.

## 2. Scope

**In scope:**
- `src/policy/operators.ts` — the full locked operator set (§3.1).
- `src/policy/evaluator.ts` — condition-tree walker + dot-notation field resolution (§3.2).
- `src/policy/transition-guard.ts` — guard matching + evaluation (§3.3).
- `src/policy/agent-responsibility.ts` — `when` evaluation → suggestion entries (§3.4).
- `src/policy/engine.ts` — evaluation functions the write handlers call at the right points (§3.5).
- `core/envelope.ts` — `policies_fired` population (type already exists; §3.6).
- Write-tool integration: `create_task` (responsibilities), `update_task` (guards on group change + responsibilities) (§3.7).
- `whoami` — add the easter-egg `hints` entry (§3.8).
- `reverse_captcha` — stub MCP tool (§3.8).

**Out of scope (later phases):**
- `validation` and `automation` policy classes — NOT in v1 at all (design doc lists four classes; v1 ships two).
- Policy mutations / side effects (`automation` actions: `set_field`, `add_comment`, etc.) — no policy writes state in v1.
- Substrate-edit tools (Phase 4).
- HTTP API mirror + UI (Phase 5).
- Real `reverse_captcha` puzzle (Phase 6).
- Policies on comment writes — comment writes do NOT trigger policy evaluation in v1 (the only comment-triggered class, `automation`, is out).

## 3. Design

### 3.0 Locked scope decisions (Diego, 2026-05-28)

1. **Operator set: the FULL design-doc locked set** (§3.1), not the trimmed arch-plan list. They're cheap pure functions; substrate authors can already reference them.
2. **`transition_guard` fires on `update_task` group changes ONLY.** A guard engages when `update_task` changes `group_id`; `create_task`'s initial placement is not a transition and never blocks on a guard.
3. **`agent_responsibility` fires on `create_task` AND `update_task`**, evaluated against post-write state.

### 3.1 Operators (`src/policy/operators.ts`)

Pure functions; no I/O. Each takes the resolved left-hand field value and (where relevant) the condition's `value` / `values`. The full locked set:

| Group | Operators | Semantics |
|---|---|---|
| Existence | `exists` | field resolves to a non-`undefined`, non-`null` value |
| | `not_exists` | field is `undefined` or `null` |
| | `is_empty` | `null`/`undefined`/`''`/`[]`/`{}` (no own keys) |
| | `not_empty` | negation of `is_empty` |
| Equality | `eq`, `neq` | strict `===` / `!==` after JSON-value normalization |
| Sets | `in`, `not_in` | membership of the field value in `values[]` |
| Numeric | `gt`, `gte`, `lt`, `lte` | numeric compare; non-numeric operand → no match (never throws) |
| String | `contains`, `not_contains` | substring (field coerced to string) |
| | `starts_with`, `ends_with` | string prefix / suffix |
| | `matches_regex` | `value` compiled with a guarded `RegExp` (see R-1); no match on invalid pattern |
| | `matches_any_keyword` | true if any string in `values[]` appears (case-insensitive, substring) in the field |
| Array | `has_any` | field is an array sharing ≥1 element with `values[]` |
| | `has_all` | field is an array containing every element of `values[]` |

Compound combinators live in the evaluator, not here: `all_of`, `any_of`, `none_of`.

**R-1 (ReDoS):** `matches_regex` is the only operator compiling substrate-authored strings. Substrate is user-authored (semi-trusted), but a pathological pattern could hang the single-threaded server. Mitigation: cap pattern length (e.g. 1000 chars) and wrap compile+test; on `RegExp` throw → treat as no-match (never crash a write). Documented in the operator header. (No full ReDoS sandbox in v1 — accepted risk for a local single-user tool.)

### 3.2 Evaluator (`src/policy/evaluator.ts`)

```ts
export type LeafCondition = {
  field: string;
  op: LeafOperator;
  value?: unknown;
  values?: unknown[];
};
export type Condition =
  | LeafCondition
  | { all_of: Condition[] }
  | { any_of: Condition[] }
  | { none_of: Condition[] };

export interface EvalContext {
  task: Record<string, unknown>; // full task incl. custom_data
}

export function evaluateCondition(cond: Condition, ctx: EvalContext): boolean;
export function evaluateConditions(conds: Condition[], ctx: EvalContext): boolean; // implicit all_of
```

- A bare array (`require: [...]`, `when: [...]`) is an implicit `all_of`.
- `all_of` → every child true (vacuously true if empty). `any_of` → ≥1 true (false if empty). `none_of` → no child true.
- **Field-reference resolution rule (established Phase 2, arch plan §Phase 2):** the dot path is interpreted **literally first**, then falls back to the `custom_data`-nested path. For a `task` context, `task.priority` resolves `task.priority` if present, else `task.custom_data.priority`. `task.custom_data.x` resolves literally. Unresolvable paths yield `undefined` (so `exists` is false, `eq` no-match — never throws). Documented with worked examples in the evaluator header; each example gets a test (R-P3-1).
- The evaluator NEVER throws on bad operator/operand combinations — it returns `false`. A malformed policy is structurally rejected at load time (Phase 2 validator) where possible; anything that slips through degrades to "condition not met," never a crashed write.

### 3.3 Transition guards (`src/policy/transition-guard.ts`)

`definition` shape (design doc §Class: transition_guard):
```ts
{ from_group: string; to_group: string; require?: Condition[]; on_failure_message?: string }
```
- `'*'` wildcard matches any group for `from_group` and/or `to_group`.
- **Engagement:** a guard engages on an `update_task` that changes `group_id`, when `from_group` matches the *prior* group and `to_group` matches the *target* group (with `'*'` wildcards).
- **Evaluation:** an engaged guard's `require` conditions are evaluated against the **candidate post-write task** (existing ∪ patch, post custom_data merge). All-of semantics.
  - Pass → the guard is recorded as fired (informational, no message) and the write proceeds.
  - Fail → the write is **rejected** with `SubstrateError.transitionBlocked(on_failure_message ?? <default>, { policy_id, from_group, to_group })`. Guards run in `priority` ascending (tiebreak `created_at`); **stop on first failure** ("any failure rejects the write"). The transaction rolls back.
- Archived/`enabled: false` policies are skipped.

### 3.4 Agent responsibilities (`src/policy/agent-responsibility.ts`)

`definition` shape (design doc §Class: agent_responsibility):
```ts
{ when?: Condition[]; message: string }
```
- **Engagement:** evaluated after a successful `create_task` / `update_task`, against the **post-write** task state. `when` matches (implicit all_of; empty `when` ⇒ always matches) → the policy is recorded in `policies_fired` with its `message`.
- Never blocks. Disabled/archived policies skipped. Order: `priority` ascending, tiebreak `created_at`.

### 3.5 Engine (`src/policy/engine.ts`)

The engine exposes evaluation functions the handlers call — it does **not** open its own transaction (Phase 2 lock: the handler owns the tx). This keeps guard evaluation inside the write tx (so a block rolls back) and responsibility evaluation after commit (read-only envelope assembly).

```ts
// Throws SubstrateError.transitionBlocked on first failing engaged guard.
export function runTransitionGuards(args: {
  board: Board;
  fromGroup: string;
  toGroup: string;
  candidate: EvalContext;
}): PolicyFiredEntry[]; // the guards that engaged AND passed

export function runAgentResponsibilities(args: {
  board: Board;
  state: EvalContext;
}): PolicyFiredEntry[];
```

Per-write orchestration (in the handler):
- **create_task:** existing flow (validate board/group, field_schema, write, `created` event) → after commit, `runAgentResponsibilities({ board, state: createdTask })` → envelope `policies_fired`. (No guards — not a transition.)
- **update_task:** inside the tx, after merge + field_schema validation, **before** `updateTask`: if `group_id` is changing, `runTransitionGuards(...)` against the candidate state (a throw rolls back). Then `updateTask` + `updated` event. After commit, `runAgentResponsibilities` against the post-write task. Guard-fired (passed) entries + responsibility entries both go in `policies_fired`.
- **R-P3-2 (cumulative state):** v1 has no automation, so policies never mutate state. Responsibilities see the literal post-write task. Guard `require` sees the candidate (about-to-be-written) state. Test fixtures cover both.

### 3.6 Envelope (`core/envelope.ts`)

`PolicyFiredEntry` and `policies_fired` already exist (Phase 1). No type change required. Confirm `successEnvelope(applied, policiesFired)` is threaded by the write handlers. Entry shape:
```ts
{ policy_id, policy_name, policy_type: 'transition_guard' | 'agent_responsibility', description?, message? }
```
`message` set for responsibilities; omitted for passed guards. A blocked guard returns an **error** envelope (`transition_blocked`), never a success envelope.

### 3.7 Tool integration

Only `create_task` and `update_task` change (engine calls). `archive_task` / `unarchive_task` / all comment writes / all reads are unchanged. Error conventions unchanged (Phase 2 §3.6) plus: `transition_blocked` leads with the guard's `on_failure_message`, details `{ policy_id, from_group, to_group }`.

### 3.8 whoami + reverse_captcha

- `whoami.hints` → `["Try the reverse_captcha tool — small puzzle for agents only."]` (was `[]`). `phase` → `v0.0.3 (policy engine + envelope)`.
- `reverse_captcha` stub: input `{}`; returns `{ error: "Coming in v0.1.0", about: { built_by: "Diego Ferreyra", site: "https://diegoferreyra.com" } }`. Registered in the registry; routed through `wrapToolHandler`.

## 4. Key end-to-end flow (acceptance fixture)

Substrate board with two policies:
- `transition_guard`: `from_group:'todo'`, `to_group:'in_progress'`, `require:[{field:'task.custom_data.repro_steps', op:'exists'}]`, `on_failure_message:'Set repro_steps before moving to In Progress.'`
- `agent_responsibility`: `when:[{field:'task.title', op:'matches_any_keyword', values:['login','auth']}]`, `message:'May relate to auth-domain tasks; consider linking.'`

Flow: create task in `todo` with an auth-y title → `created` + responsibility fires in `policies_fired`. update_task → `in_progress` without `repro_steps` → `transition_blocked` error. Add `repro_steps`, retry → success, guard passes (listed), responsibility still fires.

## 5. Edge cases

| Case | Expected |
|---|---|
| update_task with no group change | no guards run (even if guards exist) |
| update_task group change, no matching guard | proceeds; no guard entries |
| guard `require` references a missing field via `exists` | condition false → guard fails → `transition_blocked` |
| guard passes | proceeds; guard listed in `policies_fired` (no message) |
| disabled / archived policy | skipped entirely |
| `matches_regex` with an invalid/oversized pattern | treated as no-match; write not crashed |
| empty `when` on a responsibility | always matches → always fires |
| numeric op (`gt`) on a non-numeric field | no match; no throw |
| two guards engage, first fails | `transition_blocked` from the first (priority order); second not evaluated |
| responsibility on create_task matching `when` | fires in `policies_fired` |
| field-ref literal vs custom_data fallback | `task.priority` → literal `priority`, else `custom_data.priority` |

## 6. Test strategy

- `operators.test.ts` — unit per operator incl. empties, type-mismatch no-match, regex guard.
- `evaluator.test.ts` — handcrafted condition trees; compound `all_of`/`any_of`/`none_of` incl. empty; field-ref literal + fallback worked examples.
- `transition-guard.test.ts` — engagement matching (incl. `'*'`), pass→listed, fail→transitionBlocked, priority order stop-on-first-failure, disabled skip.
- `agent-responsibility.test.ts` — when-match, empty-when always fires, post-write state.
- `engine.test.ts` — orchestration: guards pre-write/throw, responsibilities post-write.
- Tool tests extended: `update-task.test.ts` (guard block rolls back — no version bump, no event; guard pass; responsibility entry), `create-task.test.ts` (responsibility entry, no guards).
- `reverse-captcha.test.ts` + `whoami.test.ts` (hint).
- Integration: extend `mcp-bootstrap-flow.test.ts` with the §4 fixture flow.

## 7. Acceptance criteria

- transition_guard fixture: a write failing the guard returns `transition_blocked` with the configured message; the task is unchanged (tx rolled back, no `updated` event).
- agent_responsibility fixture: matching writes include the policy in `policies_fired` with its message.
- Mixed policies fire in priority order; `policies_fired` includes only engaged policies.
- `whoami` returns the easter-egg hint; `phase` updated.
- `reverse_captcha` stub returns the placeholder.
- `pnpm test` green; `tsc --noEmit` (root+ui), `eslint`, `prettier`, `pnpm build` clean.
- `pnpm test:smoke:concurrency` + `node tests/manual/run-smoke.mjs` green.
- Every write that ran policies did so within the Phase 2 tx-ownership model (guards inside the tx; no engine-owned tx).
- `BINARY_VERSION` → `0.0.3`.

## 8. Recommended decisions — ALL CONFIRMED (Diego, 2026-06-01)

1. **Stop-on-first-failure for guards** (vs. collect-all-failures). Recommend stop-on-first — matches design doc "any failure rejects," simpler envelope.
2. **Passed guards appear in `policies_fired`** (informational, no message) — gives agents visibility that a guard ran. Recommend yes (matches "engaged").
3. **`matches_regex` guard**: cap length + treat invalid/throw as no-match; no ReDoS sandbox in v1. Recommend accept.
4. **Engine = handler-called functions, not a tx-owning orchestrator** — preserves the Phase 2 lock. Recommend yes.
5. **No schema change / no migration in Phase 3.** Recommend confirm.

## 9. Definition of Done (for this spec)

Approved by Diego when §3.0 locked decisions stand and the §8 recommendations are confirmed or amended. Then per workflow.md Stage 2: Architect drafts the Phase 3 plan → Architect Reviewer → revision → Diego approves → development.
