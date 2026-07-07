# Dogfood rollup — scoreboard

The current standing against the PRD §9 kill-criteria and §4 success metrics, aggregated
across all `projects/*.md` + [journal.md](journal.md). Update periodically; **evaluate at
week 8**. Numbers here should trace to instrumented data (event log / `logs`) where possible,
not agent self-report.

- **Dogfood window start:** _<set: first week Substrate ran on a real project>_
- **Week 8 review due:** _<start + 8 weeks>_
- **Last updated:** _<date>_
- **Projects in the window:** _<n>_ — see [projects/](projects/)

## §9 kill-criteria (ANY firing by week 8 = the bet didn't pay)

| # | Criterion | Threshold | Current | Status |
|---|---|---|---|---|
| 1 | Silent bail on primary project | not stopped ≥2 consecutive wks (no external reason) | _tbd_ | ⬜ |
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
