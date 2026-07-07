# Policy integrity — enforceable gates + verifiability — Spec

**Status:** Draft for Diego's review
**Author:** Architect (from the spec analyst's grounded analysis)
**Date:** 2026-07-07
**Companion (build plan):** [policy-integrity.md](../policy-integrity.md)
**Grounding:** `.agents/dogfood/rollup.md` (B3 + the `missing:validate`/dry-run signals),
`.agents/dogfood/projects/stackchanexperiments.md` (the honor-system gate in the wild), and
the code cited inline.
**Scope:** three demand-proven fixes in one cluster — **B3** (honor-system
`transition_guard`s), **`substrate validate`** (policy-definition + referential-integrity
lint), **dry-run transition** (a non-mutating "would this move be allowed?" read).

> **Two plans, not one.** Items 2 (`validate`) and 3 (`dry-run`) are additive, PRD-clean, and
> plannable **immediately**. Item 1 (B3) reopens a **locked PRD framing** (`agent_name` is
> "self-attested, not forensic" — prd.md:37, prd.md:121, prd.md:402) and is **blocked on Diego's
> §6 decisions** before it can be built. The build plan therefore ships 2+3 as **Track A**
> (unblocked) and B3 as **Track B** (gated). Do not let B3 hold the verifiability work.

---

## 1. Problem & motivation

Three failures in the same theme — **the board's own rules are not trustworthy**:

1. **B3 — human-approval gates are honor-system.** A `transition_guard` checks a field's
   **value**, never **who wrote it**. `guardPasses` evaluates `def.require` against the
   post-write task only (`transition-guard.ts:48`), and the candidate context is
   `{ task: {...} }` with **no actor** (`update-task.ts:114,119`). So a
   `require: [{ field: "task.plan_approved", op: "eq", value: true }]` gate passes the
   instant *anyone* — including the agent the gate exists to stop — sets `plan_approved:true`.
   **Confirmed in the wild:** StackChan's nightly autonomous pipeline has a gate
   `gate-plan-approved` whose message reads *"The agent must NOT set plan_approved"*; the agent
   set it in its own `update_task` and walked straight through (`stackchanexperiments.md:22,27`).
   The pipeline's **core human-approval gate is not enforced**.

2. **No way to lint the substrate without touching state.** The validation logic already exists
   but only runs **on load** (`loader.ts` → `validateSubstrate`) and **on write**
   (`validateBoardStructure`, `definition-schema.ts`). There is **no standalone command** to
   check "is every gate live?" before an agent hand-edits JSON. `substrate diagnose` loads the
   substrate but swallows the specific error into a one-line `bad('boards/', message)`
   (`diagnose.ts:69`) — it proves the substrate *loads*, not that every gate is *live*. Dogfood:
   *"a silently-dead gate is worse than no gate… 4 of 5 gates went unverified in one session"*
   (rollup.md:110).

3. **No non-mutating way to test a gate.** To answer "would moving task X to group Y be allowed
   *now*?" an agent must `create → attempt-move (block) → fix → pass → archive`, leaving a
   soft-deleted corpse (rollup.md:110). The engine already does the pure work
   (`runTransitionGuards`, `engine.ts:48`, returns entries or throws without touching storage);
   there's just no read-only entrypoint to it.

## 2. The load-bearing findings (why this is tractable)

- **The policy engine is pure / I-O-free.** `runTransitionGuards` (`engine.ts:48`) takes
  `{ board, fromGroup, toGroup, candidate }` and returns entries or throws `transition_blocked`
  **without any storage access**. `update_task` builds exactly this candidate at
  `update-task.ts:114-119` *before* the SQLite write. A dry-run is that call, minus the write.
- **The validators already exist and are reused across paths.** `validateSubstrate`
  (`validator.ts:30`) covers duplicate board/group ids, enum-without-values, malformed policy
  `definition` (via `validatePolicyDefinition`, `definition-schema.ts:101`), and
  `transition_guard` from/to group refs (`validator.ts:104-116`). `validate` is a **presentation
  layer** over these, sibling to `diagnose.ts`.
- **The interactivity spec is already building the actor stamp B3 needs.** D2
  (`interactive-ui-spec.md:91`) injects a **server-stamped, un-spoofable** `human:<os-username>`
  actor on the HTTP write path (§7 security: *"no client-supplied identity to spoof"*,
  `interactive-ui-spec.md:184`). **B3 and D2 must share one actor model** — do not invent a
  second.

## 3. Goals / non-goals

**Goals**
- **B3 (Track B):** a `transition_guard` can gate on **who is moving the card** — a server-derived
  `actor.kind` (`'human' | 'agent'`) an MCP agent cannot forge — so the human-approval gate the
  nightly pipeline leans on is actually enforced.
- **`validate` (Track A):** a standalone `substrate validate` command that runs the existing
  throwing validators as **errors** (exit 1) and a new non-throwing lint pass as **warnings**
  (exit 0 unless `--strict`), catching the "silently-dead gate" failure at author time.
- **`dry-run` (Track A):** a read-only MCP tool `check_transition` that answers "would this move
  be allowed now?" against the current (or a hypothetical) task state, **writing nothing**.

**Non-goals**
- **No authentication, no tokens, no access control** (prd.md:54). `actor.kind` is derived from
  *which code path* wrote (human UI/CLI vs agent MCP), not from a credential — this is the
  reframe §6.1 asks Diego to confirm, not a walk-back of "no auth".
- **No field-level ACL in v1.x** (Option B below) unless dogfood shows authors keep forgetting the
  `actor.kind` clause. B3 gates the **move**, not the **field**.
- **No new operators, no new policy class, no automation.** B3 reuses the locked leaf DSL and the
  `eq` op; `validate`/`dry-run` reuse the engine and validators verbatim.
- **No visual policy editor** (that's interactive-ui Phase 16, deferred).
- **`dry_run:true` flag on `update_task`** is rejected — see §5 D-3-1.

## 4. API / contract changes

### 4.1 B3 (Track B) — `actor.kind` in the eval context

- **`EvalContext`** (`policy/types.ts:60`) gains an optional `actor` sibling to `task`:
  ```ts
  export interface EvalContext {
    task: Record<string, unknown>;
    actor?: { kind: 'human' | 'agent'; name: string };
  }
  ```
  Optional so every existing eval call site and test compiles unchanged (back-compat, §5 D-1-3).
- **`resolveField`** (`evaluator.ts:46`) already dispatches on the path root
  (`evaluator.ts:52`, `ctx[root]`). Adding `actor` to the context makes `actor.kind` /
  `actor.name` resolvable with **no evaluator change** — the root-dispatch is generic. A guard
  becomes:
  ```jsonc
  "require": [
    { "field": "task.plan_approved", "op": "eq", "value": true },
    { "field": "actor.kind",        "op": "eq", "value": "human" }
  ]
  ```
  No new operator — reuses `eq`.
- **`ToolDeps`** (`mcp/deps.ts:16`) gains `actor: { kind: 'agent'; name: string }` for the MCP
  path (see §5 D-1-2 for why MCP is always `kind:'agent'`). The write handler builds
  `candidate: { task, actor: deps.actor }`.
- **MCP bootstrap** (`server.ts` / `mcp.ts` deps construction): stamps `kind:'agent'` and
  **normalizes/rejects a client-supplied `human:` prefix** on `agent_name` so an MCP agent
  literally cannot present as a human.
- **`definition-schema.ts` LEAF_OPERATORS** unchanged. `validatePolicyDefinition` unchanged
  (`actor.kind == human` is a normal leaf; the `field` string is free-form by design).
- **`move_blocked` event** (`update-task.ts:207` `recordMoveBlocked`) carries the actor-kind so
  the human sees *why* a move was blocked ("agent tried a human-only move").

### 4.2 `validate` (Track A)

- **New CLI command** `substrate validate [--strict]` → new file `src/cli/commands/validate.ts`
  (mirrors `diagnose.ts`), registered in `src/cli/index.ts` and the `HELP` block.
- **New non-throwing lint** `lintSubstrate(substrate): LintFinding[]` added to
  `src/substrate/validator.ts` (additive — does not touch the throwing `validateSubstrate`).
  ```ts
  interface LintFinding {
    level: 'warning';
    board_id: string;
    policy_id?: string;
    code: 'empty-require' | 'unresolved-field' | 'archived-group-ref' | 'unenforced-human-gate';
    message: string;
  }
  ```
- **Exit contract:** any throwing-validator error → exit 1 (with the `substrate_corrupt`
  paste-able fix prompt surfaced, `corrupt.ts`); lint warnings → exit 0 (exit 1 only under
  `--strict`); clean substrate → exit 0, no warnings; empty substrate → "no boards to validate",
  exit 0.

### 4.3 `dry-run` (Track A) — `check_transition` read tool

- **New MCP read tool** `check_transition` → new file `src/mcp/tools/read/check-transition.ts`,
  registered in `registry.ts` in the read block.
  - **Input:** `{ task_id: string; to_group: string; custom_data?: Record<string, unknown> }`
    (the optional `custom_data` tests a hypothetical without persisting).
  - **Output (raw read payload, no envelope — reads return raw data, PRD §6.5):**
    ```jsonc
    {
      "allowed": true,
      "to_group_valid": true,
      "blocked_by": { "policy_id": "…", "policy_name": "…", "message": "…" }, // present iff !allowed
      "guards_evaluated": [ { "policy_id": "…", "policy_name": "…" } ]
    }
    ```
- **Shared candidate-builder (recommended extraction, §5 D-3-2):** extract the board-lookup +
  candidate-build block from `update-task.ts:60-121` into a helper both `update_task` and
  `check_transition` call, so a dry-run can never disagree with the real move. A **parity test**
  pins them together.
- **B3 composition:** if B3 lands, `check_transition` from an MCP agent is `kind:'agent'`, so it
  correctly reports "blocked: needs a human" — the agent learns the human-only block *before*
  hitting it.

## 5. Decisions with recommendations

### B3 — actor model
**D-1-1 — Mechanism: `actor.kind` in the eval context (recommended core).**
Add `actor` to `EvalContext`; let guards gate on `actor.kind`. Reuses the DSL, the `eq` op, and
D2's stamp — **one actor model, not two**. Smallest new concept surface. *Trade-off:* the field
stays agent-writable (an agent can still set `plan_approved:true`); the gate blocks the **move**,
not the field. That's arguably the right boundary — but a **dead gate** (author forgets the
`actor.kind` clause) looks live, which Item 2's `unenforced-human-gate` lint catches at author
time. **Recommend: adopt.**

**Rejected — Option B (field-level `writable_by:'human'` ACL).** Stronger invariant (the field is
genuinely un-settable by an agent) but a **bigger** surface: new `field_schema` concept
(`FieldSchemaEntry`, `types.ts` + Zod + `field-validator.ts`) **plus** the same actor plumbing as
D-1-1. A v1.x scope expansion for a narrower win. **Recommend: defer**; revisit only if dogfood
shows authors keep forgetting the clause (§6.3).

**D-1-2 — Trusted actor derivation is path-specific and server-side, never from the payload.**
- **MCP path:** the agent supplies `agent_name` (`update-task.ts:45`) → the server sets
  `kind:'agent'` and **rejects/normalizes a `human:` prefix** so an MCP agent cannot forge a
  human identity. `agent_name` **stays self-attested** for the *name* (PRD-consistent).
- **Human path:** `kind:'human'` is reachable **only** through a server-controlled human
  entrypoint (D2's HTTP write path, or a `substrate approve` CLI — see §6.2). The *only* way to
  get `kind:'human'` is to come through that path. This threads the PRD's "not forensic" needle:
  we authenticate the **code path** (server-known), not an **identity** (client-supplied).

**D-1-3 — Back-compat: `actor` is optional; value-only gates are unchanged.**
`EvalContext.actor` is optional; a guard with no `actor.kind` clause evaluates exactly as today
(unresolvable `actor.*` → `undefined`, but such gates don't reference it). Pin the entire existing
`update-task.test.ts` policy suite unchanged.

### `validate`
**D-2-1 — Thin CLI over existing validators (errors) + a new non-throwing lint (warnings)
(recommended).** The error tier reuses `validateSubstrate`/`definition-schema` verbatim; the
warning tier (`lintSubstrate`) is the only net-new code. Keeps v1 scope: the *command* is
demand-proven (`missing:validate`, rollup.md:110,124), the lints target the exact named failure.

**D-2-2 — Lint contents (all warning-level, because `custom_data` is open-ended):**
1. **`empty-require`** — a guard whose `require` is empty always passes → not a gate.
2. **`unresolved-field`** — a `require`/`when` `field` targeting `task.<name>` that resolves to
   no declared `field_schema.task` entry → likely a dead condition
   (`evaluator.ts:23` "unresolvable → undefined → eq no-match"). **Warning only** — must not
   false-positive on a valid-but-undeclared `custom_data` field (field_schema isn't exhaustive
   for custom_data); message says "if this is an intended custom_data field, ignore."
3. **`archived-group-ref`** — a guard referencing an archived group (loads fine per
   `validator.ts:19`, but may be a mistake).
4. **`unenforced-human-gate` (the B3 heuristic, §6.4)** — a guard whose
   name/description/`on_failure_message` matches `/human|approv|must not/i` but has **no
   `actor.kind` clause** → "reads like a human-approval gate but is honor-system (see B3)." This
   is the single highest-leverage safety net — it catches the exact B3 failure at author time,
   and it's useful **even before B3 ships** (it flags the risk).

### `dry-run`
**D-3-1 — A new read tool `check_transition`, not a `dry_run:true` flag on `update_task`
(recommended).** Overloading a **write** tool with a read semantic muddies the envelope contract
(write tools return `SuccessEnvelope`; a dry-run has no `applied`/`version`) and is easy to misuse
(forget the flag → real write). The read/write split is a deliberate PRD invariant (§6.5).
**Recommend: read tool.**

**D-3-2 — Extract the shared candidate-builder now (recommended, small).** `check_transition` and
`update_task` must build the candidate identically or a passing dry-run is a lie. Extract
`update-task.ts:60-121`'s board-lookup + candidate-build into a helper both call. This is the same
instinct as the interactivity spec's §2 operations-layer extraction — but far smaller. If Diego
prefers to defer the refactor, the fallback is **duplicate + a parity test** (§7). **Recommend:
extract**; it's cheap and removes a whole class of drift bug.

**D-3-3 — Current state by default, optional `custom_data` override for hypotheticals.** Default
answers "can I move it *now*?"; the override answers "*if* I set `tests_passing`, could I?" — a
**simulation**, never persisted. Same-group `to_group` → `allowed:true, guards_evaluated:[]`
(guards don't engage, matches `update-task.ts:113`). Invalid/archived `to_group` →
`to_group_valid:false` (a soft diagnostic, friendlier than a hard error for a *check* tool).

## 6. Open questions for Diego (BLOCKING for Track B / B3)

1. **PRD framing reconciliation.** B3 requires a server-trusted `actor.kind`, a *partial*
   walk-back of "self-attested, not forensic" (prd.md:37, prd.md:402). Confirm the reframe:
   **`agent_name` stays self-attested; `actor.kind` (human vs agent, derived from code path)
   becomes trusted.** We are not authenticating *identity* (no auth/no tokens, prd.md:54) — we're
   distinguishing *code path* (server-known, not client-supplied). Capture in `decisions.md`.
   *Without this, Track B cannot be built.*
2. **Human entrypoint for `kind:'human'`.** Does B3 **depend on D2's HTTP write path** (couples
   B3 to interactivity Phase 13), or ship a standalone **`substrate approve <task>` CLI** now so
   the autonomous pipeline has an enforceable gate *before* the UI lands? *Recommendation: the
   CLI — it decouples B3 from the interactivity roadmap and gives StackChan an enforceable gate
   immediately. On a fully-autonomous pipeline, "a human runs a CLI command" IS the intended
   out-of-band friction — the gate should require a human act the 4am agent cannot invoke in-band.*
3. **Field-ACL (Option B) — in or out for v1.x?** *Recommendation: out; revisit only if authors
   demonstrably forget the `actor.kind` clause (Item 2's `unenforced-human-gate` lint will tell
   us).*
4. **Retroactive safety.** Existing honor-system gates (StackChan's `gate-plan-approved`) stay
   honor-system until re-authored with an `actor.kind` clause. Should `substrate validate` **warn**
   on such a gate (the `unenforced-human-gate` heuristic)? *Recommendation: yes — highest-leverage
   safety net; ships in Track A regardless of when B3 lands.*

## 7. Edge cases

- **Field still agent-writable (D-1-1).** An agent can still write `plan_approved:true`; it just
  can't *transition through the guard* without a human actor doing the move. Document: the gate is
  on the **move**, not the field. (Option B would close this; deferred.)
- **`actor` root vs `custom_data` fallback.** `actor.kind` must resolve as a literal, not fall
  through to `task.custom_data`. Verified: `resolveField` dispatches on `segs[0]` as the context
  root (`evaluator.ts:52`); `actor` is a sibling of `task`, and a `Task` has no top-level `actor`
  field, so **no collision**. Unit-test both resolutions.
- **`human:` prefix forgery.** MCP `update_task` with `agent_name:"human:diego"` must be
  normalized/rejected server-side so it can never yield `kind:'human'`.
- **Wildcard human gates.** A `from:'*' to:'*'` guard with an `actor.kind` clause fires on *every*
  move — Item 2 may note broad-wildcard human gates; confirm it's the author's intent.
- **`validate` false-positives.** `unresolved-field` must NOT fire for a valid custom_data field
  not declared in `field_schema`; keep it a heuristic **warning** with a clear "ignore if
  intended." `'*'` wildcards in from/to are refs-to-nothing by design — never warn
  (matches `validator.ts:109`).
- **`check_transition` reports only the FIRST blocking guard** (engine throws on first failure,
  `engine.ts:68`) — same semantics as a real move (honest), but document that a passing dry-run
  guarantees only *that* guard; later gates evaluate in priority order.
- **Responsibility path** (`runAgentResponsibilities`, `engine.ts:83`) could also expose `actor`
  (e.g. "remind the human to…"), but that's non-blocking; in scope only if free.

## 8. Test strategy

Validate locally (**CI is billing-blocked** — rollup + phase-12 plan §2): Vitest against a fresh
SQLite/temp substrate per the workflow test rules; do **not** gate merge on GitHub Actions.

- **B3 — the exact StackChan regression:** a board with
  `require:[plan_approved==true, actor.kind==human]`; MCP `update_task` (agent) setting
  `plan_approved:true` and moving → `transition_blocked`; the same move via the human entrypoint
  (`kind:'human'`) → passes.
- **B3 — prefix forgery:** MCP `update_task` with `agent_name:"human:diego"` → normalized/rejected;
  never yields `kind:'human'`.
- **B3 — context resolution:** `resolveField('actor.kind', ctx)` for both kinds; `actor` root
  doesn't fall through to `custom_data`.
- **B3 — `move_blocked` event** carries actor-kind.
- **B3 — back-compat:** the whole existing `update-task.test.ts` policy suite passes unchanged.
- **validate:** guard referencing a non-existent group → exit 1 with the group id; malformed
  `definition` (bad `op`) → exit 1; **lints:** empty `require` → warning; `task.tests_passing`
  not in field_schema → warning; archived-group ref → warning; `unenforced-human-gate`
  heuristic fires without an `actor.kind` clause and is silent with it; clean substrate → exit 0,
  no warnings; snapshot the CLI output shape (like `diagnose.test.ts`).
- **dry-run:** blocked/allowed cases write **no** `updated`/`move_blocked` event and leave the task
  version unchanged; `custom_data` override flips the result without persisting; same-group →
  `allowed:true, guards_evaluated:[]`; archived/missing `to_group` → `to_group_valid:false`;
  **parity test:** for the same board+task, `check_transition` matches the real `update_task`
  outcome (both allowed, or both blocked with the same `policy_id`).

## 9. Sequencing note

The three items compound: **B3 introduces `actor.kind` → `validate` warns when a gate should use
it but doesn't → `dry-run` lets an agent see the human-only block before hitting it.** But
`validate` and `dry-run` are **independently shippable without B3** (they just won't carry the
actor-aware checks yet — and the `unenforced-human-gate` lint is still valuable, flagging the risk
even before B3 lands). So: ship **Track A (validate + dry-run) now**; ship **Track B (B3) after
Diego's §6 decisions**, then add the actor-aware lint/dry-run behavior.
