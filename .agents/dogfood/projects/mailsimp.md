# Dogfood — mailsimp (mailsimp-web)

## Profile

- **Slug / repo:** `mailsimp` — `/Users/diegoferreyra/WebDevelopment/mailsimp/mailsimp-web`
- **Kind of work:** phased delivery pipeline (Spec → Plan → review → Execution; Phases 40–43)
- **Agents / roles:** an orchestrator managing phases across **multiple boards** (Planning + Execution)
- **Started on Substrate:** — · **still active?** unknown
- **Boards:** Planning + Execution (multi-board)
- **Report date:** 2026-06-26 — **pre** the `list_tasks` summary projection (Phase 11 / PR #12), so the 68 KB overflow here is the *original* size problem.

## Instrumented data

- **`logs --errors`:** **empty — `.substrate/logs/` never created** despite ~30 MCP calls and multiple `not_found` errors this session. MCP-spawned server writes no on-disk error trail. `logs` supports only `-n`/`--errors` (no `--help`, no time/tool filter).
- **Writes:** ~20; each `create_task`/`update_task` echoed full description + `custom_data` back in the envelope (big read per write).

## Agent reports (normalized)

#### Report — mailsimp · orchestrator · 2026-06-26
- **Friction:** `list_tasks` returned an identical **68,935-char blob 4×** ("exceeds maximum allowed tokens"), dumped to a file to python-slice; **`board_id` silently ignored** (couldn't scope down). Write envelopes echo full task body.
- **Errors hit:** `not_found` ×2 (`create_task` bad group, `get_task` bad id) → **recovered from message alone** (messages named the fix: `get_board_substrate` / grep the dump). No version_mismatch/transition_blocked/schema_violation/conflict/corrupt.
- **Policy changed behavior?:** **no** — guards passed silently (fields already set); `agent_responsibility` "Spawn the right analysts" fired but agent had already decided. Guardrails matched what it was already doing.
- **Suggestions noticed & acted on?:** read `policies_fired`, **acted 0 times**; a policy it authored minutes earlier echoed back = redundant in-session (useful only for a *future* agent).
- **Bail moment?:** **yes ×2** — (1) python-slicing the dumped list vs. a markdown `grep`; (2) re-sending **entire** `custom_data` on every group-move (**full-replace, not merge**) = more ceremony than a one-line edit.
- **Missing capability:** **task-to-task dependencies** (encoded "Phase 43 merges after 41" in free-text `blocker`; nothing computes order); `update_task` **no merge**, **no `parent_id`/reparent**; `list_tasks` **can't filter or return titles-only**.
- **Situational awareness from board alone?:** **partial** — could read *where* (column positions) but not *what's next* (lived in prose `blocker`).
- **Staleness:** **yes (integrity bug)** — parked a **Planning-board card into the Execution board's "Merged" group**; `update_task` **accepted a `group_id` from a different board with no error** → board shows a structurally-impossible placement you'd misread.
- **Biggest single change requested:** **fix the read path** — honor `board_id`/group/state filters, add titles-only/field-select, stop echoing full bodies in write envelopes (root cause of the missing-IDs → `not_found` → extra round-trips). Close 2nd: first-class task dependencies. Runner-up: actually persist errors to `.substrate/logs/`.
- **Signal tags:** `friction:list_tasks` `context-overflow` `policy-noise` `suggestion-ignored` `bail` `missing:dependencies` `missing:partial-update` `missing:filter` `stale-board` `awareness-gap`
