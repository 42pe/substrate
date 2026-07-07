# Substrate dogfood journal

The evidence base for the **PRD §9 week-8 go/no-go**. Substrate v1 is a bet; this folder
is where we record whether the bet is paying off on Diego's real projects, so the decision
is made on logged specifics — not vibes.

> **Why this matters:** the PRD's hardest-to-see failure mode is that *"Substrate can't
> observe work — it only sees what agents self-report; if writes don't happen at the right
> moments the board silently diverges and the 'visibility' is fiction."* (PRD §9). Watch that
> harder than agents-ignoring-suggestions.

## What's here

| File | Purpose |
|---|---|
| [feedback-prompt.md](feedback-prompt.md) | The prompt to give **agents** for end-of-run feedback (+ an as-you-go variant). Copy-paste. |
| [feedback-schema.md](feedback-schema.md) | The structure to **normalize** each agent report into, so reports are comparable and roll up to metrics. |
| [journal.md](journal.md) | **Diego's** chronological moment-log — the PRD §9 journal proper (the 6 capture categories). |
| [rollup.md](rollup.md) | The **scoreboard**: current standing against the §9 kill-criteria + §4 success metrics. Update periodically. |
| [projects/](projects/) | One file per dogfood project: profile, Diego's observations, normalized agent reports, instrumented data. Use [`_template.md`](projects/_template.md). |

## Flow

1. **Per project** → create `projects/<slug>.md` from the template; fill the profile.
2. **From agents** → paste the [feedback prompt](feedback-prompt.md) at the end of a run; normalize the reply into the project file via the [schema](feedback-schema.md).
3. **From Diego** → log dated moments in [journal.md](journal.md) as they happen (the highest-signal input).
4. **From the board itself (instrumented, > self-report)** → on each project pull:
   - `npx @diegoferreyra/substrate logs --errors` (mcp/serve warnings + stack traces),
   - the event log / activity feed: `policies_fired` rate, `move_blocked` count, and **`version_mismatch` retry loops** (the PRD R4 livelock),
   - counts of boards/tasks/policies created vs. abandoned; any `list_tasks` context overflows post-summary-fix.
5. **Periodically** → update [rollup.md](rollup.md); at **week 8**, evaluate the four kill-criteria.

## The §9 kill-criteria this feeds (any one firing = bet didn't pay)

1. Diego **stopped using** it on the primary project ≥2 consecutive weeks (no external reason) — silent bail.
2. **< 3 distinct** "markdown/Linear would have failed me here" moments logged (vague "felt nice" doesn't count).
3. **`agent_responsibility` engagement < 15% of writes** across projects.
4. **< 3 distinct policy *patterns*** authored across all boards (shapes, not instances).

**1 or 2 fires** → paradigm failed; freeze v1. **3 or 4 fires** → engagement failed; reduce the
engine to what got used (kills the *suggestion class*, not the tool — durable state +
`transition_guard`s stand on their own). See prd.md §9 + decisions.md.
