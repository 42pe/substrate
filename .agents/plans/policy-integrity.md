# Dogfood fix — Policy integrity: enforceable gates + verifiability

**Status:** Draft for Diego's review (authored directly — workflow draft stage infra-limited).
**Design-heavy — B3 needs Diego's decision before build.**
**Author:** Architect
**Date:** 2026-07-07
**Source:** [.agents/dogfood/rollup.md](dogfood/rollup.md) (B3) + astrology/StackChan reports
**Related:** the human-actor model in [interactive-ui-spec.md](specs/interactive-ui-spec.md) §D2.
**CI:** billing-blocked → validate **locally**.

---

## Problem & decisions

### B3 — human-approval gates are honor-system (HIGH — the top design item)
**Root cause:** a `transition_guard` checks a field's **value**, not **who set it**
(`src/policy/engine.ts`, `src/policy/transition-guard.ts`). On StackChan's **4am autonomous
pipeline**, the agent set its own `plan_approved:true` and walked straight through, despite the
message "the agent must NOT set this." The human-approval gate the whole pipeline leans on is **not
enforced** — and `agent_name` is a **free-form, unauthenticated tag** (`src/core/types.ts`), so
Substrate cannot today distinguish a human write from an agent write.

**This is a design decision (needs Diego).** Options:
- **(A — Recommended) Human-only fields, enforced at the MCP write boundary.** A board marks fields
  (e.g. `plan_approved`) as **`human_only`**; the **agent's `update_task`/`create_task` MCP tools
  refuse to set them** (`forbidden`). That alone fixes the autonomous case — the 4am agent can't
  self-approve, so the task **stops at the gate** — and needs **no UI**. The human flips the field via
  any non-agent channel: a `substrate approve`/`substrate set` **CLI** (ship this), hand-edit, or the
  web write-UI later. **The write-UI is the ergonomic human front-end, NOT a prerequisite.**
  When the interactivity write path lands (Phase 13 / spec D2), it stamps `human:<os-user>`
  server-side, giving the same fields a nice GUI approval — additive.
  **Honest limit:** on a local, no-auth, single-machine tool you cannot *cryptographically* prove a
  human made the write (an autonomous agent with shell/localhost access could shell out to the CLI).
  `human_only` means "not settable via the agent's normal MCP tool surface" — self-approval goes from
  *happens accidentally in-flow* (what bit StackChan) to *requires a deliberate break-out to another
  channel it was told not to use*. A strong practical boundary for an honest-agent tool, not an
  unbreakable one. Document this plainly.
- **(B) A first-class approval record** — a dedicated `approve(task, gate)` action only a
  human-origin caller can invoke, separate from `custom_data`; guards check the record. More
  surface, cleaner semantics.
- **(C) A `set_by` provenance operator** — track per-field "who last set this" and add a guard
  operator `field_set_by: human`. Most flexible, most work.
**Recommendation:** **A** — smallest lift that actually enforces, and it composes with the
interactivity actor stamping we already specced (so human‑via‑UI approvals "just work"). Until an
authenticated human origin exists, document plainly that approval gates are **advisory** for
autonomous agents (don't let them look enforced — a silently-unenforced gate is worse than none).

### `substrate validate` — catch silently-dead gates (MED)
**Root cause:** malformed/misreferenced policies "load fine but silently never engage" (AUTHORING.md);
astrology verified only **1 of 5** gates live. `diagnose` counts policies but validates no logic.
**Decision:** a `substrate validate` CLI (+ optional MCP `validate_substrate`) that, per board:
- parses every policy `definition` (reuse `src/policy/definition-schema.ts`);
- checks **referential integrity** — `from_group`/`to_group` resolve to real groups; `field` refs
  resolve against `field_schema` (or are known task fields); operators are valid;
- reports each policy as OK / dead-with-reason. Exit non-zero on any dead policy (CI-friendly).

### dry-run transition — verify a gate without a corpse (MED)
**Root cause:** proving a gate fires needs create→block→pass→archive (4 calls + a soft-deleted task).
**Decision:** a **dry-run** — MCP `check_transition({task_id|candidate, to_group})` (and/or
`substrate explain-transition`) that runs `runTransitionGuards` (`engine.ts:48`) against current (or
hypothetical) state and returns would-block + which conditions fail — **no write, no task**. Reuses
the pure guard evaluator.

## Implementation order
1. **`substrate validate`** (lowest risk, high value, no design decision) — new
   `src/cli/commands/validate.ts` reusing `definition-schema.ts` + a ref-integrity pass; wire into
   `diagnose` output too.
2. **dry-run** — `check_transition` MCP tool (+ CLI) over `runTransitionGuards`; read-only.
3. **B3 (Option A) — ships in two independent layers, no UI dependency:**
   - **(core, now)** board-level `human_only` field list + the agent's `update_task`/`create_task`
     MCP tools **reject** writes to those fields (`forbidden`); a `substrate approve`/`set` **CLI** as
     the human channel. This fully fixes the autonomous self-approval case on its own.
   - **(additive, later)** when the Phase 13 write path lands, it stamps `human:<os-user>` and gives
     the same fields a GUI approval — nice-to-have, not required.
   - Land the "approval gates are advisory for autonomous agents until human_only ships" **doc note
     immediately**, regardless.

## Acceptance criteria (validate locally)
- `substrate validate` flags a board with a dead gate (bad group ref / unparseable definition) and
  passes a healthy board; non-zero exit on dead policies.
- `check_transition` returns allowed/blocked + failing conditions with **no** task created and **no**
  state change.
- *(B3-A, if approved)* an **agent-origin** write that sets a `human_only` field is **rejected**; the
  same field set via a **human-origin** write (UI/CLI) succeeds and the gate then passes. A regression
  test proves an autonomous agent can no longer self-approve.
- `pnpm lint`/`format`/`tsc`/tests green.

## Risks
- **R1 (B3 scope):** the **core** fix (MCP refuses `human_only` fields + CLI approve) does **not**
  depend on the web UI and can ship now. The later UI stamping (Phase 13 / D2) is additive — don't
  build two provenance systems; the MCP boundary is the source of truth, the UI just becomes another
  human-origin caller. Land the **advisory-gate doc note** immediately regardless.
- **R2 (validate):** must match the *loader's* validation exactly, or `validate` and runtime disagree
  — reuse `definition-schema.ts`, don't re-implement.
- **R3 (dry-run):** must use the same evaluator as the write path to avoid drift.

## DoD
Branch `fix/policy-integrity`; `validate` + dry-run land first; B3 provenance gated on Diego's option
choice + sequenced with Phase 13; advisory-gate note shipped immediately; `decisions.md` records the
B3 direction.
