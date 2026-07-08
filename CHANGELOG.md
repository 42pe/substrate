# Changelog

All notable user-facing changes are tracked here. This project adheres to
[Semantic Versioning](https://semver.org/). Per-phase internal build notes live
in `.agents/audits/phase-{N}-audit.md`.

## [Unreleased]

_Nothing yet._

## [0.6.0] - 2026-07-07

### Changed

- **`list_tasks` now returns lightweight summary rows by default.** A list of a
  busy board used to return every task's full `description` and `custom_data`
  (a 35-task board was ~69KB — enough to overflow an agent's context). Rows are
  now a summary: the small fields verbatim, a bounded `description_excerpt`
  (+ `description_truncated`), and a `custom_data` trimmed to small scalar
  values, with bulky keys listed in `custom_data_omitted`. Read a task in full
  with `get_task(id)`, pass `view: 'titles'` for the leanest id/title/group rows,
  or `view: 'full'` (MCP) / `?view=full` (HTTP) for the complete rows. Filters are
  now **top-level params** (`board_id`, `group_id`, `in_groups`, `text_search`,
  `custom_field`, `missing_required_fields`, …) rather than nested under a
  `filters` object (the nested form still works, deprecated). Filtering is
  unaffected — `custom_field` and `missing_required_fields` still run against the
  full task.

### Added

- **Human-approval gates you can see and report on.** A board field can be marked
  `human_only` (B3): an agent's write tools refuse to set it and `update_board`
  refuses to un-protect it, so a `transition_guard` requiring it becomes a real
  human gate an unattended agent can't self-clear. A human sets it with the new
  **`substrate approve <task_id> <field> [value]`** (stamped `human:<user>`).
  Surfacing it: the **`list_pending_approvals`** MCP tool + **`substrate
  pending-approval`** CLI + `GET /api/pending-approvals` list every task waiting on
  a human, with the gate and the exact field to set; a distinct **"pending
  approval"** pill marks those tasks on the kanban card and task-detail in the UI.
  Also new: **`check_transition`** (dry-run whether a move would pass the guards,
  without a throwaway task) and **`substrate validate`** (lint boards + policies
  without a server; corrupt → non-zero exit for CI).
- **A fresh worktree / clone now warns instead of silently diverging.** Because
  `.substrate/data.sqlite` is gitignored, a git worktree or fresh clone checks out
  the boards but starts with an empty task database — an agent there would operate
  on an empty board it doesn't share with your main checkout. `mcp`/`serve` now
  warn loudly on startup when they open a `.substrate/` that has boards but just
  created an empty database. (See the README's "Worktrees & fresh clones".)
- **The inspector now shows agent activity and schema gaps.** Two additions make
  enforcement and data quality visible to the human:
  - A new **Activity** page (and `GET /api/activity`) — a live, cross-board feed
    of "who did what, when": task creates/updates/archives, comment activity,
    guard `move_blocked` rejections, and the policies that engaged on a write.
    Newest-first, polling live like the rest of the inspector.
  - **Kanban cards flag tasks missing a required field** with an amber badge
    (the card lists which fields on hover). The board-columns API now returns
    `missing_required_fields` per task, using the same rule as
    `list_tasks(missing_required_fields)`.
- **A broken board file now reports how to fix it.** When a `.substrate/boards/*.json`
  is malformed or structurally invalid, Substrate fails to load with a new
  `substrate_corrupt` error (instead of a generic `internal_error`) that names
  the exact file and includes a ready-to-paste prompt — surfaced both in the
  message and in `details.fix_prompt` — that you can hand to an AI agent to
  repair it. The strict whole-substrate load is unchanged (one broken board
  still fails the load, so a broken gate never silently vanishes); only the
  error is now actionable.
- **Policy activity is now recorded in task history.** When a `transition_guard`
  blocks a move, Substrate records a `move_blocked` event (with the policy id,
  from/to groups, and the block message) — so the enforcement is visible even
  though the move rolled back and left no other trace. When a policy engages on
  a successful `create_task` / `update_task`, the entries are persisted on that
  write's `created` / `updated` event under `changes.policies_fired` (atomic
  with the write), in addition to being returned in the response envelope. This
  makes guard and agent_responsibility engagement auditable in the history and
  countable over time. `get_task_history` accepts `move_blocked` as an
  `event_types` filter value.
- **Policy definitions are now validated.** `create_policy` and `update_policy`
  check the `definition` against the policy `type` and reject a malformed one
  with `schema_violation` (naming the offending field) instead of storing a
  policy that loads fine but silently never engages. A `transition_guard` needs
  `from_group`/`to_group`; an `agent_responsibility` needs a non-empty `message`;
  every condition's `field`/`op` and compound (`all_of`/`any_of`/`none_of`)
  shape is checked, and unknown keys (e.g. a typo'd operator or `valeu`) are
  rejected.
- **The `create_policy` / `update_policy` / `get_board_substrate` tool
  descriptions now document the policy DSL and field-schema shapes inline**, so
  an agent can author a correct gate from the MCP tool surface alone (without
  the bundled skill).

### Changed

- **Archival is now consistent across boards and groups.** `archive_board` is
  rejected with `conflict` if the board still has active tasks (it previously
  archived regardless), mirroring `archive_group`. `create_task` refuses to add
  a task to an archived board or group, and `update_task` refuses to move a task
  into an archived (or non-existent) group — all with a clear `conflict` /
  `not_found`.
- **A malformed policy definition in a hand-edited board file now fails the
  load loudly** (`internal_error`, naming the board + policy) rather than
  loading and silently never engaging. If you have parked a half-written policy
  on disk, fix its shape or remove it. (Whole-substrate load behavior is
  otherwise unchanged; per-board degradation is tracked separately.)
- **`version_mismatch` now returns the current version.** The error's `details`
  carry `current_version`, so a concurrent writer no longer needs a wasted
  `get_task` / re-read just to fetch the integer before retrying. The message
  still requires re-read + reconcile before retrying — the safeguard is the
  requirement, not the withheld number. (Reverses the earlier deliberate
  omission.)
- **Edit one field on a board without resending the whole schema.**
  `update_board` accepts a **`field_schema_patch`** — merge/add the given fields;
  a `null` value deletes one — instead of requiring the entire `field_schema`.
- **Your own error trail is now reviewable with `substrate logs --errors`.**
  Handled tool errors (schema violations, forbidden writes, not-found, …) are now
  recorded to the persistent log as they happen, so an agent session's mistakes
  are diagnosable after the fact. Routine control-flow outcomes
  (`transition_blocked`, `version_mismatch`) are intentionally excluded, and the
  agent/client still only ever receives the generic scrubbed error envelope.

## [0.5.0]

### Added

- **Share a substrate's workflow as a template.** Publish your boards (with their
  groups / fields / policies — never tasks or data) in a Git repo or folder, and
  let someone apply them to their project.
  - **`substrate add <path> [--yes] [--as <id>]`** — merge a template's boards
    into an existing `.substrate/`. **Dry-run by default**: with no `--yes` it
    validates and previews, writing nothing; `--yes` applies (transactionally,
    rolling back on any mid-apply failure). Board-id collisions refuse by default;
    `--as <id>` renames a single-board template on apply.
  - **`substrate init --template <path>`** — the `--template` flag now accepts a
    local template directory (not just the bundled `web-delivery` name), writing
    all of its boards into a fresh project.
  - A **`substrate-template.json`** manifest describes a template (name,
    description, version, board list); a folder also resolves by convention from
    `.substrate/boards/` or `boards/`. The CLI is **network-free** — it takes a
    local path; your agent does the clone.
- The bundled `examples/web-delivery` now ships a manifest, so it doubles as a
  working shareable template you can `substrate add`.

## [0.4.0]

### Added

- **Substrate now keeps a persistent error log.** The long-lived `mcp` and
  `serve` processes record warnings and errors (with stack traces for
  unexpected failures) to `.substrate/logs/substrate.log` — so when something
  goes wrong it's diagnosable after the fact, even if your agent runtime
  swallowed the server's stderr. The file is gitignored and never transmitted;
  the agent/client still only ever receives the generic scrubbed error envelope
  (the full detail stays local).
- **`substrate logs [-n <N>] [--errors]`** — print recent log lines (default
  last 50; `--errors` filters to errors and shows their stack traces). Reads
  across a rotation so `-n` is honored.
- **`substrate diagnose`** gains a "recent errors" section (the last few error
  headers + a pointer to the full log), so a bug report is often just
  `diagnose` + the log.
- Size-bounded by single-generation 5 MiB rotation (`substrate.log.1`).

## [0.3.0]

### Added

- **The board view is now a kanban.** The web inspector renders each board as
  columns (one per workflow group, in order) instead of a flat task table —
  cards sit under the group they're in, with a live per-column count. A
  **List** toggle switches back to the searchable/filterable table, and the
  long tail of a busy column opens there via "+N more". Board description,
  field schema, and policies are tucked into a collapsible "Board details"
  panel so the columns lead.
- **The Overview is now a multi-board wall.** Every board shows as a horizontal
  strip of columns with a capped card preview, so you can see where work sits
  across all boards on one page.
- **The inspector updates itself.** It polls a few times a minute (pausing when
  the tab is hidden), so when an agent moves a task between groups over MCP the
  board reflects it within seconds — the moved card briefly highlights. The UI
  stays strictly read-only: it observes moves, it doesn't make them (no
  drag-and-drop).
- New read endpoint `GET /api/boards/:id/columns` backing the kanban (counts +
  capped, ordered per-column preview). No MCP tool-surface change.

## [0.2.1]

### Fixed

- **`substrate serve` now serves the web UI from any project directory.** The
  built UI is located relative to the install, not the current working directory,
  so the UI no longer shows the "not built yet" placeholder when `serve` is run
  outside the Substrate repo.
- **`Ctrl+C` (SIGINT) on `substrate serve` now exits promptly** instead of
  hanging at "shutting down" when a browser tab holds a keep-alive connection
  open (open sockets are dropped on shutdown, with a timeout backstop).

## [0.2.0]

### Added

- **`substrate init --template <name>`** — initialize with a starter board.
  `web-delivery` ships a stack-agnostic Spec → Plan → Build → Review → QA → Done
  workflow with policy gates. Bare `substrate init` stays blank.
- **`substrate explain [--out <file>]`** — write a self-contained, offline HTML
  map of the substrate: per board an inline-SVG flow diagram (hover for detail)
  plus the field-schema and policy tables. No external assets.

## [0.1.0] — first public release

The initial public release of Substrate: a local-first, per-project,
agent-collaborative project-management substrate exposed over MCP, with a
local read-only web inspector.

### Added

- **CLI** — `init`, `serve` (localhost web UI on `:7475`), `mcp` (stdio MCP
  server), `backup`, `export`, `import`, `diagnose`.
- **MCP tool surface** — read tools (project/boards/tasks/comments/history),
  task + comment write tools, and substrate-edit tools for authoring
  boards/groups/fields/policies. Every write returns an envelope listing the
  policies that fired.
- **Policy engine (v1)** — `transition_guard` and `agent_responsibility`
  classes with an operator set and priority ordering.
- **HTTP read API + React inspector** — localhost-only `GET /api/...` endpoints
  and a read-only UI (project → boards → board detail → task detail with
  comments and event history). Author markdown is rendered through a single
  DOMPurify-sanitized path.
- **`reverse_captcha`** — a small, timed logic puzzle for agents (the `whoami`
  hint points here). Easter egg.
- **Storage** — libsql/SQLite with WAL mode and a forward-only migration
  runner; substrate-as-code JSON read fresh on every call.

### Notes

- Supported platforms: macOS and Linux (primary, CI-tested); Windows/WSL
  best-effort (CI matrix leg is visible but non-blocking).
- npm package provenance is deferred to a future release (the v0.1.0 toolchain
  pins pnpm 7, which predates `--provenance`).
