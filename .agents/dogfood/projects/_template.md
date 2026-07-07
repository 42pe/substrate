# Dogfood — <project name>

Copy this to `projects/<slug>.md` per dogfood project. One file = everything about how
Substrate performed on that project.

## Profile

- **Slug / repo:** `<slug>` — `<repo or path>`
- **Kind of work:** _<e.g. product build, research pipeline, ops>_
- **Agents / roles:** _<how many, which roles>_ · **concurrency:** _<sequential | concurrent teams>_
- **Started on Substrate:** _<date>_ · **still active?** _<yes/no; if no, when + why>_
- **Template / setup:** _<init template used, if any>_
- **Boards:** _<count + names>_

## Policies authored here

_List each policy by **shape** (so the rollup can count distinct patterns, not instances)._

| Policy | Class | Shape / what it enforces | New pattern? |
|---|---|---|---|
| | `transition_guard` / `agent_responsibility` | | yes/no |

## Instrumented data (pull from the board itself — > self-report)

- **`logs --errors`:** _<notable warnings/errors, or "clean">_
- **Writes total / engaging ≥1 `agent_responsibility`:** _<n / n = %>_  ← feeds §9-3
- **Writes engaging ≥1 `transition_guard`:** _<n / n = %>_
- **`move_blocked` events:** _<n>_ · **`version_mismatch`:** _<n; any retry *loops*?>_ ← R4 livelock
- **`list_tasks` responses:** _<any context overflows? sizes>_
- **Boards/tasks/policies created vs. abandoned:** _<…>_

## Diego's observations

_The high-signal stuff. Cross-reference dated entries in [../journal.md](../journal.md)._

- **Did the board stay authoritative, or drift?** _<…>_
- **Stale/divergence incidents:** _<board said X, reality Y; how long unnoticed>_
- **markdown-would-have-failed moments here:** _<…>_
- **Web UI used?** _<…>_

## Agent reports (normalized — see [../feedback-schema.md](../feedback-schema.md))

_Paste one normalized block per agent report._

<!-- #### Report — <project> · <role/id> · <date> ... -->
