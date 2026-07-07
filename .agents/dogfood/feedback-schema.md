# Agent-report normalization schema

Turn each raw agent reply (from [feedback-prompt.md](feedback-prompt.md)) into this
structure inside the relevant `projects/<slug>.md`. Keeping every report in the same shape
is what lets them **roll up** to the §9 kill-criteria and §4 metrics instead of being a pile
of prose. Copy the block per report.

```markdown
#### Report — <project> · <agent role/id> · <YYYY-MM-DD>

- **Friction** (P1 top items): …
- **Errors hit**: [transition_blocked | version_mismatch | schema_violation | not_found |
  conflict | substrate_corrupt] → for each: **recovered from message alone? yes/no** + note.
- **Policy changed behavior?**: yes / no / partly — which policy, and would-have-done-anyway?
- **Suggestions (`agent_responsibility`) noticed & acted on?**: acted / ignored / clutter — example.
- **Bail moment?**: none / <trigger>.
- **Missing capability**: <what it wanted that didn't exist / worked around>.
- **Situational awareness from board alone?**: yes / no — gap.
- **Staleness**: none / <board diverged: what & whether caught>.
- **Biggest single change requested**: …
- **Signal tags** (for rollup — pick any that apply):
  `friction:<tool>` · `unrecoverable-error:<code>` · `policy-redirect` · `policy-noise`
  · `suggestion-acted` · `suggestion-ignored` · `bail` · `missing:<capability>`
  · `stale-board` · `context-overflow` · `awareness-gap`
```

## How each field maps to the decision

| Report field | Feeds |
|---|---|
| "Policy changed behavior?" + "Suggestions acted on?" | **Kill-criterion 3** (`agent_responsibility` engagement ≥15%) — *corroborates* the event-log %; agent claims alone aren't the measure. |
| "Bail moment?" + "Situational awareness" + "Staleness" | **Kill-criterion 1** (silent bail) + the PRD's hardest failure mode (board diverging from reality). |
| "Missing capability" | v1.x scope signal — `automation`/operator/`validation` gaps (PRD §9 v1.x is *gated on dogfood demand*). |
| "Errors recovered from message alone?" | Error-message quality — the actionable-error work (`substrate_corrupt`, `version_mismatch` no-`current_version`) is validated or refuted here. |
| "Friction" + "context-overflow" | UX/DX backlog; confirms the `list_tasks` summary fix and finds the next overflow. |

## Weighting

- **Observed > reported.** An agent saying "suggestions were useful" is weak; the event
  log showing writes that engaged an `agent_responsibility` (and the *next* write doing what
  it suggested) is strong. Use reports to find *where to look*, then verify in the data.
- **A "no issue" is data**, not a gap to fill. Don't fish for problems that weren't there;
  don't fish for praise either.
- **Cross-agent agreement** on a friction point outranks a single loud complaint.
