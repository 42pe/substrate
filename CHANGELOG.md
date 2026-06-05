# Changelog

All notable user-facing changes are tracked here. This project adheres to
[Semantic Versioning](https://semver.org/). Per-phase internal build notes live
in `.agents/audits/phase-{N}-audit.md`.

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
