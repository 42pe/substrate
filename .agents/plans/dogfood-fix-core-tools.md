# Dogfood fix — Core read/write tool correctness & ergonomics

**Status:** Draft for Diego's review (authored directly — the workflow teams' draft stage hit
repeated infra rate-limits; grounded in the dogfood collection + verified file:line reads)
**Author:** Architect
**Date:** 2026-07-07
**Source:** [.agents/dogfood/rollup.md](dogfood/rollup.md) (bugs B1, B2, B6 + ergonomics)
**Scope:** the tool-loop friction every dogfood agent hit on the single-worktree happy path.
**CI:** billing-blocked → all acceptance bars validate **locally**.

---

## Problem & decisions

### B1 — `list_tasks` silently returns the whole project (HIGH — every read)
**Root cause (confirmed):** filters are nested under a `filters` object and the group filter is
`in_groups` (array), not `group_id` (`src/mcp/tools/read/list-tasks.ts:55`). Agents call it
flat/singular (`list_tasks(board_id=…, group_id=…)`); Zod strips the unrecognized top-level keys
and the handler returns the **whole unfiltered set**. Fails **silently** — the worst outcome.
All 3 dogfood agents hit this; it's the #1 friction.
**Decision (needs Diego — API contract; Substrate is pre-npm so a breaking change is fine):**
- **(Recommended) Flatten filters to top-level** tool params (`board_id`, `group_id`,
  `in_groups`, `archived`, `text_search`, …), keep accepting the nested `filters` object for one
  release as a deprecated alias, and add **`group_id`** as sugar for a single-group `in_groups`.
- **AND make misplacement loud:** reject unrecognized top-level keys with a `schema_violation`
  that names them ("unknown filter `group_id` — did you mean `in_groups`/`group_id`? filters go at
  top level"). A misplaced/misnamed filter must **never** silently return everything.
- Add a **`fields`/titles-only** projection option (beyond `view: summary|full`) so a caller can
  ask for just id+title+group when triaging.

### B2 — `update_task`/`create_task` accept a `group_id` from a *different board* (HIGH — integrity)
**Root cause:** the write handlers set `group_id` without checking it belongs to the task's board
(`src/mcp/tools/write/update-task.ts`, `create-task.ts`) → a card can be placed in a
structurally-impossible group (mailsimp parked a Planning card into the Execution board's group).
**Decision:** in the write handler (the board is already loaded for policy evaluation), validate
`group_id ∈ board.groups` (and not archived); else return `not_found`/`schema_violation` naming the
board + valid groups. Same check on `create_task` and `update_task`.

### B6 — passed `transition_guard` clutters the success envelope (LOW)
**Root cause:** on a successful move, `policies_fired` lists the passed guard with **no `message`**
(`src/core/envelope.ts`, `src/policy/engine.ts:48`). A bare record the agent ignores.
**Decision (recommended):** **omit passed `transition_guard`s from the success envelope** — a guard
that didn't block conveys nothing actionable; keep guards only on the *block* (error) path. Keep
`agent_responsibility` entries (they carry the load-bearing `message`). Reduces success-path noise.

### Write-envelope echo (MED — ergonomics)
`create_task`/`update_task` echo the full `description` + `custom_data` back in `applied.state`
(a big read per write; mailsimp). **Decision:** return a **lean applied entity** by default
(id, version, group_id, title, updated_at) and gate the full body behind the same `view: 'full'`
knob `list_tasks` uses. (Astrology reported write envelopes felt fine on a small board, so this is
size-proportional — lean default, opt-in full.)

### Partial update / merge (MED — the #1 bail trigger)
`update_task.custom_data` is **full-replace** (re-send the whole object to change one key —
mailsimp) and `update_board` requires the **entire `field_schema`** (StackChan bailed to editing
JSON). **Decision:** add **merge/patch** semantics without breaking OCC:
- `update_task`: a `custom_data_patch` map (shallow-merge; a `null` value deletes a key), distinct
  from the existing full-replace `custom_data`.
- `update_board`: targeted field-schema ops (add/rename/remove one field; append-to-description)
  rather than whole-object replace. (Groups/policies already have targeted edit tools.)

## Implementation order
1. **B1** — reshape `list_tasks` input (`list-tasks.ts:55`): flatten + deprecated-nested alias +
   `group_id` sugar + strict unknown-key rejection + titles-only projection. Update the tool
   description + SKILL/AUTHORING docs + the UI client (`ui/src/lib/api.ts` `getTasks`).
2. **B2** — group-belongs-to-board validation in `update-task.ts` + `create-task.ts`.
3. **Write echo** — lean `applied.state` in `src/core/envelope.ts` builders + write handlers; `view`
   passthrough.
4. **B6** — filter passed guards out of the success `policies_fired` (`engine.ts`/`envelope.ts`).
5. **Partial update** — `custom_data_patch` (`update-task.ts`, `tasks.ts` repo) + board field-schema
   partial ops (`update-board.ts`, `src/substrate/writer.ts`).

## Acceptance criteria (validate locally)
- `list_tasks({board_id, group_id})` returns ONLY that board+group; a misplaced/misnamed filter
  returns `schema_violation` (never a silent full dump); titles-only projection works; UI List view
  still renders.
- `update_task`/`create_task` with a `group_id` from another board → `not_found`/`schema_violation`,
  no write.
- Successful write envelope carries the lean entity by default, full only with `view:'full'`; no
  passed-guard entries in `policies_fired` on success.
- `custom_data_patch` merges (and `null` deletes) without touching untouched keys; OCC `version`
  still enforced. Board field-schema partial op adds one field without resending the whole schema.
- `pnpm lint`, `pnpm format:check`, `tsc`, unit + integration green; existing tests updated for the
  new `list_tasks` shape.

## Risks
- **R1 (B1 contract):** flattening changes the `list_tasks`/`GET /api/tasks` shape — coordinate the
  UI client + tool description + any SKILL docs in the same PR. Pre-npm, so acceptable.
- **R2 (B6):** some consumer may rely on seeing passed guards; grep the UI/tests first.
- **R3 (patch semantics):** `null`-deletes-key is a convention to document clearly to avoid
  surprise; keep full-replace `custom_data` available.

## DoD
Branch `fix/dogfood-core-tools`; step commits; local validation green; merge; note the `list_tasks`
contract change in `decisions.md` + CHANGELOG.
