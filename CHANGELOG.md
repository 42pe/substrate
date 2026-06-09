# Changelog

All notable user-facing changes are tracked here. This project adheres to
[Semantic Versioning](https://semver.org/). Per-phase internal build notes live
in `.agents/audits/phase-{N}-audit.md`.

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
