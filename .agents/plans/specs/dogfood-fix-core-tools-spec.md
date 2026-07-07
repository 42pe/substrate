# Core read/write tool correctness & ergonomics — Spec (dogfood fix cluster)

**Status:** Draft for Diego's review
**Author:** Architect (from the read/write-correctness Spec-Analyst report)
**Date:** 2026-07-07
**Feeds:** [Build plan](../dogfood-fix-core-tools.md) (Stage-2)
**Source signals:** [`../../dogfood/rollup.md`](../../dogfood/rollup.md) (bug table B1–B7),
[`../../dogfood/projects/mailsimp.md`](../../dogfood/projects/mailsimp.md),
[`../../dogfood/projects/stackchanexperiments.md`](../../dogfood/projects/stackchanexperiments.md)
**Scope discipline:** v1 correctness + ergonomics that dogfood *evidenced* (PRD §9 gates v1.x on
demand — which is now shown). No speculative v1.x. CI is billing-blocked (see
[phase-12 plan §2](../phase-12-ux-foundation.md)) — **validate locally**.

---

## 1. Problem & motivation

Three dogfood reports (mailsimp, astrology, StackChanExperiments) converged on a small set of
**core read/write tool defects** that hit *every* agent session. The unifying failure mode is the
one PRD §9 warns about hardest: **ambiguous or forgiving input that silently succeeds** —
producing board divergence with no error. `rollup.md:151` names it: "The gap is *silent* failures
(B1 filter, B2 cross-board), not unhelpful error text."

This cluster fixes the read/write tool *shapes and handlers* only. The storage repositories
(`storage/repositories/tasks.ts`) and the substrate writer (`substrate/writer.ts`) are **read for
context but correct** — they already take a flat `filters` object and own an atomic
temp→fsync→rename closure. Every defect below lives in `src/mcp/tools/**`,
`src/core/envelope.ts`, or `src/policy/engine.ts`.

### Snapshot drift (the biggest risk to this cluster)

`main` has moved since the dogfood snapshot was captured. **Two items are already (partly)
fixed** and must be *verify-then-pinned*, not re-implemented:

- **B2** (cross-board `group_id`) — the common case is already blocked at
  `update-task.ts:72–79` (group resolved within the task's own board → foreign id ⇒ `not_found`),
  landed 2026-06-22. A **residual same-id hole** remains (below).
- **`update_task.custom_data` merge** — already a key-by-key merge with `null`-delete at
  `update-task.ts:88–94`. The dogfood "custom_data is full-REPLACE" complaint is **stale**.

The live, unfixed defects are: **B1** (filters silently ignored), the **residual B2 same-id
hole**, **B6** (passed-guard clutter), the **write-envelope echo**, and
**`update_board.field_schema` full-replace**.

## 2. Goals / non-goals

**Goals**
- **B1:** `list_tasks(board_id=…, group_id=…)` (flat/singular — how agents actually call it)
  filters correctly; any misplaced/misspelled filter throws a `schema_violation` that names valid
  filters — **never a silent full dump**.
- **B2-residual:** an agent that *intends* a cross-board move gets an explicit "board is immutable"
  error instead of a silent same-id move; the already-landed foreign-id block is regression-pinned.
- **B6:** a passed `transition_guard` is unambiguously labelled in `policies_fired` (no bare,
  message-less success-path entry) — while remaining *countable* for the §4 guard-engagement metric.
- **Write echo:** write envelopes stop echoing full `description` + `custom_data` by default
  (lean summary), with an opt-in `view:'full'` — mirroring the read path.
- **`update_board.field_schema`:** adding/removing one field no longer requires resending the whole
  schema (the #1 authoring bail trigger).
- **Regression pins:** the already-fixed B2-common-case and `custom_data` merge are locked by tests.

**Non-goals (explicitly out of this cluster)**
- **B3** honor-system guards (needs actor/provenance — a separate design), **B4** `.substrate/logs/`,
  **B5** `version_mismatch` `current_version` (a locked decision; only flag if it touches shared
  types), the **agent-responsibility echo/dedup** (rollup finding #3).
- Task-to-task **dependencies**, **bulk/transaction** writes, **`substrate validate`**, scoped
  custom-field query language beyond what B1 already exposes (`rollup.md:104–112`) — evidenced v1.x,
  but not this cluster.
- Any storage-layer or writer-layer change; any migration (all changes are API-surface only).

## 3. Decisions

Each decision is grounded in file:line and, where it is a real design choice or reopens a locked
decision, presents options + a recommendation and is marked **needs Diego**.

### D1 — B1: `list_tasks` filter shape → flatten + `group_id` alias + `.strict()` (**needs Diego**)

**Root cause (confirmed):** `list-tasks.ts:56–73` nests every filter under `filters`
(`.optional().default({})`), and the group filter is `in_groups: z.array` (`:59`), not `group_id`.
The wrapper re-parses with `schema.safeParse` (`wrapper.ts:65`) against a plain `z.object`
(`list-tasks.ts:86`) with **no `.strict()`** — Zod 4 silently strips unknown keys. So
`list_tasks(board_id="x", group_id="plan")` → both top-level keys stripped → `filters` defaults to
`{}` → empty `WHERE` (`tasks.ts` `whereSql=''`) → **whole table, page 1, silently**. Evidenced 3/3
(`stackchanexperiments.md:20`, `rollup.md:72`, the #1 complaint, every read).

| Option | What | Trade-offs |
|---|---|---|
| **A. Flatten + `group_id` alias + `.strict()`** *(recommended)* | Promote all `filters.*` to top-level params; add `group_id?: string` sugar → `in_groups:[group_id]`; `.strict()` the top level so unknown keys throw. | Matches how agents call it; biggest ergonomic win; converts silent→loud for all future misspellings. Breaks the current nested callers — but the **only** callers are our own tests + the UI read route (no external v1 API contract). Larger diff. |
| B. Accept both nested + flat (merge) | Keep `filters`, also accept flat keys, merge with precedence. | No breakage, forgiving — but institutionalizes the very ambiguity that caused the bug; two shapes to document/test. |
| C. `.strict()` only (reject unknown, keep nested) | Smallest diff; `group_id` at top level throws with guidance. | Stops the silent dump but leaves the ergonomic mismatch (agents must still learn the nested/plural shape). |

**Recommendation: A** — flatten, alias `group_id` singular → `in_groups:[group_id]`, apply
`.strict()` on the **top level only** (keep `sort`/`pagination` as nested objects — they are
unambiguous). Keep the existing `view:'summary'|'full'` (`:84`). The repo layer
(`tasks.ts` `listTasks`/`ListTasksFilters`) is **unchanged** — it already takes a flat object; only
the tool shape + the handler's `input.filters.*` → `input.*` destructuring change.

**needs Diego** — two sub-decisions:
1. **Confirm the break is acceptable.** No external v1 API stability contract exists for tool
   shapes; the only migration cost is our tests + the UI read route. Recommend: yes, flatten.
2. **`group_id` + `in_groups` both sent.** With `.strict()` both are *allowed* keys. Options:
   (a) **union** them (`in_groups ∪ [group_id]`); (b) **reject as conflict** with guidance.
   Recommend **(b) reject** — it is the "make intent unambiguous" stance this cluster is built on;
   a caller sending both almost certainly has a bug. (Empty `in_groups:[]` stays a documented no-op
   — `tasks.ts` guards `length>0`; `.strict()` already catches the *misplacement* case, which was
   the actual bug.)

**Optional stretch (gated on scope, not required to close B1):** a titles-only / `fields`
projection for the evidenced `missing:query` demand (`mailsimp.md:36`, `stackchanexperiments.md:20`).
Recommend **defer** — B1's flatten + the existing `view:'summary'` already shrink the payload; fold
this into a later query-ergonomics item only if demand persists.

### D2 — B2-residual: optional `expected_board_id` assertion on `update_task` (**needs Diego**)

**Status — partly fixed.** `update-task.ts:63` resolves the board as the task's **own**
`board_id`; `:73` resolves `group_id` within *that* board's groups → a foreign group id ⇒
`not_found` (`:75`). `create-task.ts:58` is the same shape. **The literal B2 ("accepts a group_id
from a different board with no error") is already closed.**

**The residual hole.** Group ids are unique only *within a board* (`validator.ts` "Group IDs must
be unique within a board"). Conventional column names (`merged`, `done`, `review`) collide across
boards. When board A and B both define `"merged"` and the agent means B's, calling
`update_task(task_on_A, group_id="merged")` finds **A's** `"merged"` → moves silently, **no error**
— but the agent's cross-board intent was mis-executed. This is the exact `mailsimp.md:27` scenario
and PRD §9's watch-hardest divergence (`rollup.md:87`).

| Option | What | Trade-offs |
|---|---|---|
| A. Document current scoping only | Rely on `not_found` for foreign ids; treat same-id as "correct by scoping." | Zero code; leaves the mailsimp divergence latent whenever names collide (common). |
| B. Pin the fixed behavior only | Regression-test foreign-id → `not_found`; no new param. | Cheap; closes regression risk; doesn't address intent-mismatch. |
| **C. Optional `expected_board_id` assertion** *(recommended, with B)* | Caller may pass `expected_board_id`; if it ≠ the task's board, return a clear "task X is on board A, not B — group moves are within-board only" error. | Directly kills the intent-mismatch; small, additive, non-breaking; keeps the common single-board path frictionless. |

**Recommendation: B + C.** Pin the 06-22 fix, and add an **optional** `expected_board_id` so an
agent operating cross-board is told boards are immutable instead of silently mis-moving.
`create_task` needs **no change** (board + group both caller-supplied and cross-checked at `:58`).

**needs Diego** — is an optional assertion param the right ergonomic, or is documentation-only
(Option A/B) sufficient given the foreign-*id* case is already blocked? The residual hole only
triggers on **same-id-across-boards**; C is the targeted fix but adds one param to the shape.

### D3 — B6: label passed guards in `policies_fired` (design within the cluster)

**Root cause (confirmed):** `engine.ts:62–63` pushes `toPolicyEntry(policy)` with **no message**
for a guard that engages and passes (contrast `runAgentResponsibilities` at `:94`, always with
`def.message`). `envelope.ts:13–20` makes `message` optional, so a passed guard is a bare
`{policy_id, policy_name, policy_type:'transition_guard', description?}` on the success path —
"why is this empty-looking thing here?" clutter (`rollup.md:102`, B6, Low).

| Option | What | Trade-offs |
|---|---|---|
| A. Omit passed guards | Return `[]` for pass; only blocks surface (as the thrown error). | Cleanest success path — **but zeroes the §4 "% writes engaging ≥1 transition_guard" metric** (`rollup.md:33`), which needs to *count* firings from the event log. |
| **B. Explicit `outcome` field** *(recommended)* | Add `outcome: 'passed' \| 'fired'` (or a terse `message:"passed"`) on the guard entry; set `outcome:'passed'` at `engine.ts:63`. | Keeps the firing count *and* declutters by labelling. One optional field on `PolicyFiredEntry`. |
| C. Split channel | Keep passed guards out of the envelope but in the event's `policies_fired`. | Best of both but two behaviors to reason about — too much surface for a Low bug. |

**Recommendation: B** — add `outcome?: 'passed'` to `PolicyFiredEntry` (`envelope.ts:13`), set it
at `engine.ts:63`. Rationale: the guard-engagement metric is load-bearing for the §9-kill-criterion
read and depends on counting firings; Option A would silently break it. Keep the change tiny (Low
severity): one optional field, one call site. **Coordinate the `PolicyFiredEntry` edit** with any
future agent-responsibility-echo work (rollup #3, out of scope) so the schema changes once.

### D4 — Write-envelope echo: lean summary by default, `view:'full'` opt-in

**Root cause (confirmed):** `create-task.ts:138–146` and `update-task.ts:173–181` build
`successEnvelope` with `state: <full Task>` — full `description` + full `custom_data` echoed on
*every* write. `envelope.ts:24–37` types `applied.state: T` as the whole entity. Named in
`mailsimp.md:27` as part of "the biggest single change requested"; a heavy read on every write.

| Option | What | Trade-offs |
|---|---|---|
| **A. Lean summary by default, `view:'full'` opt-in** *(recommended)* | Default `applied.state` = `TaskSummary` (reuse `toTaskSummary`, `task-summary.ts:70`); `view:'full'` returns the whole task. | Consistent with the read path agents already learned; reuses shipped code; still returns authoritative `version` (OCC). `SuccessEnvelope<T>` widens to `Task \| TaskSummary`; consumers reading `state.description` after a write adapt or pass `view:'full'`. |
| B. Ids + version only, no `state` | Smallest payload. | Callers needing the post-write value must re-`get_task` — an extra round-trip, contra the ergonomics goal. |
| C. Echo only touched fields | Precise for `update_task` (we compute before/after). | `create_task` has no "touched subset"; type becomes a partial — awkward for the OCC `version` contract. |

**Recommendation: A** — default to a summary echo, `view:'full'` to opt in, reusing `toTaskSummary`
and the `view` enum already defined for `list_tasks`. One mental model across read and write; the
authoritative full-fidelity `version` is always present (OCC-critical); `custom_data_omitted`
signals trimmed detail. **Board echo stays full** (`update-board.ts:54`) — boards are small and
`field_schema` is the point of the edit; the complaint was task bodies only. Flagged so the plan
does not over-generalize.

**Note for the UI (Phase 13, not yet built):** if the optimistic-reconcile path needs the full
body after a write it can pass `view:'full'`; a summary + `version` is otherwise sufficient.

### D5 — `update_board.field_schema` partial patch (**needs Diego**)

**Status — split.** `update_task.custom_data` is **already** a partial merge (`update-task.ts:88–94`,
`null` deletes; description at `:43` documents it) — **regression-pin only**. The live defect is
`update_board.field_schema`: `update-board.ts:44–47` **wholesale replaces** `board.field_schema`
when `field_schema` is provided, and the shape (`:27`) requires the **entire** `FieldSchemaSchema`
(`schemas.ts:21–24`: both `task` and `comments` records). To add one field you must resend every
existing field or **destroy** the others. Evidenced: `rollup.md:107` (#1 bail trigger), ~15 calls
to author a board, agents bail to hand-editing JSON (`rollup.md:84,86`).

| Option | What | Trade-offs |
|---|---|---|
| **A. `field_schema_patch` op (add/modify/remove)** *(recommended)* | New optional input on `update_board`: per-field add/modify/remove merged onto existing (e.g. `{ task: { add:{…}, remove:[…] } }`); keep full `field_schema` for wholesale replace. | Kills the bail trigger (add-one-field = one call); mirrors the proven `custom_data` merge model (one mental model). More shape surface + must re-run `validateBoardStructure` on the merged result; must respect OCC. |
| B. Granular tools (`add_board_field`/`remove_board_field`) | Very discoverable per-op. | More tools to register/document — scope creep for v1; defer to v1.x if patch proves insufficient. |
| C. Deep-merge `field_schema` by default | Fewest new concepts. | **Silently changes the meaning** of the existing param — a caller intending a full replace (to delete a field) can no longer express it; re-introduces the exact silent-divergence class B1/B2 fight. **Reject.** |

**Recommendation: A** — an explicit `field_schema_patch` op with add/modify/remove; keep full
`field_schema` for intentional replace. It must run **inside** the same `mutateBoardFile` closure
(`update-board.ts:39`), bump `version`, and re-run `validateBoardStructure` (`:51`) on the *merged*
result so a patch can never persist an invalid board; OCC via `assertVersion` (`:38`) is unchanged.
Do **not** pursue C (silent semantic change).

**needs Diego** — two sub-decisions:
1. **Patch shape.** Confirm `{ task?: {add?, modify?, remove?}, comments?: {add?, modify?, remove?} }`
   (add = new keys, modify = replace an entry, remove = list of keys). Or fold `add`+`modify` into a
   single "upsert" map (like `custom_data`'s "set-key") + a `remove` list, which is closer to the
   already-shipped merge model. Recommend the **upsert + remove** shape for consistency.
2. **`field_schema` + `field_schema_patch` both supplied** → recommend **reject as ambiguous**
   (`.strict`-style), don't silently pick one (same anti-ambiguity principle as D1).

**Adjacent evidenced signal (optional stretch):** `mailsimp.md:36` requests **append-description**
for boards/tasks — the same "don't force a full resend" complaint. Recommend **defer** unless Diego
wants it folded in; it is not required to close the field_schema bail.

## 4. API / contract changes (summary)

All changes are **MCP tool-shape / envelope** changes. No storage schema, no board-file format, no
migration.

- **`list_tasks`** (D1): remove the `filters` wrapper; promote `board_id, in_groups, not_in_groups,
  parent_id, has_subtasks, archived, created_before/after, updated_before/after, custom_field,
  missing_required_fields, text_search` to top-level; add `group_id?: string` (alias). `sort`,
  `pagination`, `view` unchanged. Top-level `.strict()`. Tool description rewritten to advertise flat
  params. Handler destructures `input.*` (was `input.filters.*`).
- **`update_task`** (D2): `+ expected_board_id?: string` (optional assertion). `custom_data` merge
  behavior unchanged (pin only). Envelope echo → summary/`view` (D4).
- **`create_task`** (D4): `+ view?: 'summary'|'full'`. Envelope echo → summary default. B2 behavior
  unchanged (pin only).
- **`update_board`** (D5): `+ field_schema_patch?` (upsert + remove per `task`/`comments`). Full
  `field_schema` still accepted for wholesale replace; supplying both → `schema_violation`.
- **`core/envelope.ts`** (D3, D4): `PolicyFiredEntry + outcome?: 'passed'`; `SuccessEnvelope<T>`
  usage for tasks widens to `Task | TaskSummary` at the write call sites (board echo stays full).
- **`policy/engine.ts`** (D3): `runTransitionGuards` sets `outcome:'passed'` at `:63`.

## 5. Edge cases

- **B1:** `group_id` + `in_groups` both sent → reject (D1.2). Empty `in_groups:[]` → documented
  no-op. `.strict()` must not touch nested `sort`/`pagination`. `missing_required_fields` still
  requires `board_id` and short-circuits on a zero-required board (`list-tasks.ts:119–125`) —
  preserve.
- **B2:** archived target group already handled (`update-task.ts:80`); `group_id ===` current →
  no-op path (`:72`) — preserve. `expected_board_id` == the task's board → pass through unchanged.
- **B6:** a blocking guard throws `transition_blocked` and produces **no** success entry (the throw
  is the signal); only engaged-and-passed guards get `outcome:'passed'`.
- **Write echo:** `version` must always be present and full-fidelity in both views (OCC).
- **field_schema patch:** removing a field still referenced by existing task data must **not**
  orphan-check (validation is lazy — `update-board.ts:66` "schema changes never reject existing
  data"); adding a `required` field must **not** retroactively invalidate existing tasks (lazy
  required-enforcement is the contract); an `enum` added without `values` → `validator.ts` enum check
  fires on the **merged** result → `schema_violation`, nothing written; empty patch → no-op or
  reject (recommend no-op); patch + full `field_schema` → reject.

## 6. Test strategy (all local — CI billing-blocked)

Every test is a local `pnpm test` / `pnpm exec tsc --noEmit` / `pnpm lint` gate (CI green deferred
until the Actions spend limit is resolved — `phase-12-ux-foundation.md §2`).

- **B1:** `list_tasks(group_id="plan", board_id="b")` returns **only** board-b/group-plan tasks
  (the `stackchanexperiments.md:20` scenario as a regression); unknown top-level key
  (`status:"open"`) → `schema_violation` naming valid filters (loud, not silent); `group_id` ≡
  `in_groups:[x]` parity; `group_id`+`in_groups` conflict → error (per D1.2); migrate all existing
  `filters:{…}` tests in `list-tasks.test.ts` to flat form (proves no query-logic regression).
- **B2:** **pin** — foreign group id → `not_found` (06-22 fix holds); **residual** — two boards both
  defining `"merged"`, `update_task(task_on_A, group_id="merged", expected_board_id="B")` → clear
  error, no move; without `expected_board_id`, the same call moves within A (documents scoping).
- **B6:** a passing guard yields `outcome:'passed'` and no failure message; a blocking guard throws
  `transition_blocked` and produces no success entry; the metric query can still count writes with
  ≥1 guard entry.
- **Write echo:** default `update_task`/`create_task` echo has `description_excerpt` (not full
  `description`) + trimmed `custom_data`; `version` present; `view:'full'` echoes verbatim body.
- **custom_data (5a pin):** `update_task` `custom_data:{a:1}` on `{b:2}` → both; `{b:null}` deletes
  `b`; stale `version` → `version_mismatch` (merge + OCC interplay).
- **field_schema patch (5b):** patch adding one task field leaves all existing fields intact (the
  exact bail scenario); remove a field works; a patch producing an invalid board (enum w/o `values`)
  → `schema_violation`, nothing written; OCC stale version → `version_mismatch`; full `field_schema`
  replace still works; patch + full `field_schema` → `schema_violation`.

## 7. Open questions for Diego

1. **D1.1 — flatten `list_tasks` (accept the break)?** No external v1 tool-shape contract; only our
   tests + the UI read route migrate. Recommend yes.
2. **D1.2 — `group_id` + `in_groups` both sent:** reject-as-conflict (recommended) vs. union?
3. **D2 — `expected_board_id`:** add the optional assertion param (recommended) vs.
   documentation-only, given the foreign-*id* case is already blocked and only same-id-across-boards
   remains?
4. **D5.1 — patch shape:** upsert-map + `remove`-list (recommended, mirrors `custom_data`) vs.
   explicit `add`/`modify`/`remove`?
5. **D5 adjacent — append-description** for boards/tasks (`mailsimp.md:36`): fold into this cluster or
   defer? Recommend defer.
6. **Optional stretches:** titles-only/`fields` projection (D1 stretch) — defer unless demand
   persists?
