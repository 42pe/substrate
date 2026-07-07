# Dogfood rollup — scoreboard

The current standing against the PRD §9 kill-criteria and §4 success metrics, aggregated
across all `projects/*.md` + [journal.md](journal.md). Update periodically; **evaluate at
week 8**. Numbers here should trace to instrumented data (event log / `logs`) where possible,
not agent self-report.

- **Dogfood window start:** _<set: first week Substrate ran on a real project>_
- **Week 8 review due:** _<start + 8 weeks>_
- **Last updated:** 2026-07-07 (first collection — 3 agent reports)
- **Projects in the window:** **3** — [mailsimp](projects/mailsimp.md), [astrology-mobile-app](projects/astrology-mobile-app.md), [StackChanExperiments](projects/stackchanexperiments.md)

## §9 kill-criteria (ANY firing by week 8 = the bet didn't pay)

| # | Criterion | Threshold | Current | Status |
|---|---|---|---|---|
| 1 | Silent bail on primary project | not stopped ≥2 consecutive wks (no external reason) | **100% using; StackChan ~autonomous** (Diego, 07-07) | 🟢 |
| 2 | "Markdown/Linear would have failed me" moments | **≥ 3 distinct, specific** | _count from journal_ | ⬜ |
| 3 | `agent_responsibility` engagement | **≥ 15% of writes** (measured, from event log) | _tbd_ | ⬜ |
| 4 | Distinct policy **patterns** authored | **≥ 3 shapes** across all boards | _count_ | ⬜ |

**If 1 or 2 fires** → paradigm failed; freeze v1 (no `automation`/v1.x expansion).
**If 3 or 4 fires** → engagement failed; reduce engine to what got used (kills the suggestion
*class*, not the tool — durable state + `transition_guard`s stand alone). Per PRD §9 + decisions.md.

## §4 success metrics (3-month targets, Diego's projects)

| Metric | Target | Current | Notes |
|---|---|---|---|
| Continuous weeks dogfooding (≥1 real project) | ≥ 8 | _tbd_ | criterion-1 adjacent |
| Real projects run on it | ≥ 2 | _tbd_ | |
| % writes engaging ≥1 `agent_responsibility` | ≥ 20% | _tbd_ | **load-bearing**; §9-3 floor is 15% |
| % writes engaging ≥1 `transition_guard` | ≥ 30% | _tbd_ | hygiene — just confirms guards fire |
| Median policies-per-board (excl. `transition_guard`) | ≥ 2 | _tbd_ | |
| Distinct policy patterns authored | ≥ 3 by wk 8 | _tbd_ | = §9-4 |
| Median `init` → first successful agent write | ≤ 5 min | _tbd_ | onboarding friction |

## Cross-project signal tally (from normalized reports)

_Count the `Signal tags` across all `projects/*.md` reports to spot patterns._

| Signal | Count | Notes |
|---|---|---|
| `policy-redirect` (suggestion actually changed behavior) | _n_ | corroborates §9-3 |
| `policy-noise` / `suggestion-ignored` | _n_ | against §9-3 |
| `bail` | _n_ | §9-1 |
| `stale-board` | _n_ | **watch hardest** |
| `unrecoverable-error:*` | _n_ | error-message quality |
| `missing:*` | _n_ | v1.x demand signals |
| `context-overflow` | _n_ | post `list_tasks` summary fix |

## Open v1.x demand signals (gated on dogfood, per §9)

_Only build these if the journal shows concrete, repeated demand — not speculation._

- `automation` policy class — _demand?_
- Additional operators — _a policy that couldn't be expressed?_
- `validation` policy class — _rules that didn't fit `transition_guard`/`field_schema.required`?_
- HTTP MCP transport — _did the `cwd`-targeting `.mcp.json` trick prove awkward across worktrees?_
- Interactive web UI (Phases 13–15) — _did read-only frustrate?_

---

## Collection — 2026-07-07 (3 agent reports)

Projects: **mailsimp** (2026-06-26, *pre* `list_tasks` summary fix), **astrology-mobile-app**
(07-07), **StackChanExperiments** (07-07, the nightly autonomous pipeline). All three were
"problems only" prompts (so wins are under-represented — see kill-criterion 2 below).

### Convergent findings (independently in ≥2 of 3)

1. **`list_tasks` returns the whole project — filters silently ignored (3/3, #1 complaint).**
   **Root cause confirmed in code** (`src/mcp/tools/read/list-tasks.ts:55`): filters are nested
   under a `filters` object and the group filter is **`in_groups` (array), not `group_id`**.
   Agents call it flat/singular (`list_tasks(board_id=…, group_id=…)`), Zod **silently strips**
   the misplaced keys, and the full unfiltered set returns. Fails silently = worst outcome. Hit
   on **every read**.
2. **`.substrate/logs/` never created for MCP-spawned servers (3/3).** `logs --errors` is empty
   in the exact scenario it exists for; only a CLI-launched `serve`/`mcp` writes it. Agent-session
   observability is fiction.
3. **`agent_responsibility` suggestions = echo/noise when the acting agent authored them, and
   duplicated N× (3/3).** Exactly **one** clear "genuinely redirected me" across all three
   (StackChan `note-handoff-to-build`). Same message repeated verbatim **6×** in one session.
4. **Authoring API loses to hand-editing JSON — agents bail (2/3).** ~15 calls to author a board;
   `update_board`/`update_task` require **full-object resend** (no partial patch/merge).
   AUTHORING.md itself blesses hand-editing.
5. **Board diverges from reality — the PRD §9 watch-hardest failure mode, CONFIRMED (2/3).**
   8-day-stale `expected_review_date` with no signal; a task ~80% shipped still shown unstarted;
   a card parked into another board's group with no error.
6. **No situational awareness / rollup (3/3).** Board gives *shape*, not *state* — no per-group
   counts, no "what's next," no "blocked awaiting human." `whoami` returns static config.

### Severe correctness / design bugs (actionable)

| # | Bug | Severity | Fix size |
|---|---|---|---|
| B1 | `list_tasks` filter shape (nested `filters`, `in_groups`) → silent full dump | **High** (every read) | small — flatten to top-level params, or reject misplaced keys with guidance + alias `group_id` |
| B2 | `update_task` accepts a `group_id` from a **different board**, no error → impossible placements | **High** (data integrity + divergence) | small — validate group belongs to task's board |
| B3 | Human-approval `transition_guard`s are **honor-system** — check field *value*, not *who set it*; an autonomous agent self-approves and walks through | **High** (the nightly pipeline's core gate is unenforced) | **design** — needs actor/provenance or human-only fields |
| B4 | MCP-spawned server writes no `.substrate/logs/` | Medium | medium |
| B5 | `version_mismatch` omits `current_version` (Theme-5 tension; 3 agents now ask for it) | Medium | small — reconsider the locked design |
| B6 | Passed `transition_guard` in `policies_fired` has no `message` → success-path clutter | Low | small |

### Missing capabilities — now *evidenced* v1.x demand (per §9, build only on demand)

- **Task-to-task dependencies** (order not computable; stuffed in free-text `blocker`).
- **Partial update / merge** for `update_task.custom_data` + `update_board.field_schema` (the #1 bail trigger).
- **Scoped / custom-field queries** ("tasks where `source_plan==X`") + titles-only / field-select.
- **`substrate validate`** (policy-definition + ref-integrity lint) + **dry-run transition** —
  *"a silently-dead gate is worse than no gate."* 4 of 5 gates went unverified in one session.
- **Bulk / transaction writes** (12 round-trips for 2 atomic ops).
- Per-subcommand `--help` (multiple `Unknown flag`).

### Signal tally (across the 3 reports)

| Signal | Count | Note |
|---|---|---|
| `friction:list_tasks` | 3 | the universal one |
| `stale-board` | 3 | **watch hardest** — confirmed in the wild |
| `bail` (tool-surface) | 3 | authoring API + read path → file edits / grep |
| `policy-noise` / `suggestion-ignored` | 3 | against §9-3 value |
| `policy-redirect` (genuinely changed behavior) | 2 | astrology `gate-closed`; StackChan `note-handoff-to-build` |
| `missing:partial-update` | 2 | |
| `missing:validate` / `missing:query` / `missing:dependencies` / `missing:bulk` | ≥1 each | |
| `broken-gate:honor-system` | 1 | but structural — applies to every human-approval gate |
| `unrecoverable-error:*` | 0 | errors that *did* occur recovered from the message alone ✅ |
| `context-overflow` | 1 | mailsimp, pre-summary-fix |

### Early kill-criteria read (1 & 2 need Diego)

- **#4 (≥3 distinct policy *patterns*): likely 🟢 GREEN** — doc-required gate, human-approval gate,
  "spawn analysts" suggestion, "handoff carry-fields" suggestion, "contesting review." ≥3 shapes.
- **#3 (`agent_responsibility` ≥15% of writes): 🟡 AT RISK on *value*.** The class *fires*, but is
  overwhelmingly experienced as echo/noise; only **1** genuine behavior-change observed. Firing-%
  may clear 15%, but the load-bearing *value* looks thin — the "suggestion-class bet was wrong"
  signal §4 warns about. **Action: measure firing-% from the event log AND separately track
  did-it-change-behavior; don't let raw firing-rate mask low value.**
- **#2 (≥3 "markdown-would-have-failed" moments): ⚪ UNDER-MEASURED.** Problem-only prompts suppress
  win evidence; the one clear win surfaced is astrology `gate-closed` stopping an invalid Closed
  move. **Methodology fix: add a "where did it save you?" pass, and lean on Diego's journal for §9-2.**
- **#1 (silent bail): 🟢 GREEN** (Diego, 07-07). 100% using across projects; **StackChan runs
  ~autonomously at 4am, stopping only at human-approval gates**, with a self-improvement loop. The
  agent bails seen were *tool-surface* (authoring/read → file edits), not board abandonment.
  Confirms PRD §1/R8: durable cross-session state is the daily value; concurrent multi-agent
  (3 sessions) is materializing. **New v1.x demand:** atomic **task-claiming/assignee** — concurrent
  agents can duplicate work on the same task (OCC prevents corruption, not duplication); worktrees
  work today via `cwd`-targeting one shared `.substrate/`. See journal → missing-feature workarounds.

**One good-news signal:** every error that *did* occur was recovered **from the message alone**
(0 unrecoverable) — the actionable-error investment (`not_found`/`transition_blocked` guidance)
is paying off. The gap is *silent* failures (B1 filter, B2 cross-board, B3 honor-system), not
unhelpful error text.
