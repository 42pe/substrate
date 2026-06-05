# Substrate

**Substrate** is a local-first, per-project project-management substrate that AI agents and humans share. It runs as a single npm binary in your repo: agents read and write boards, tasks, comments, and policies over a stdio **MCP** server, while you inspect the same data in a local web UI. Everything lives in a `.substrate/` directory beside your code — a JSON "substrate-as-code" definition of boards/groups/fields/policies plus a local SQLite database of runtime state. No accounts, no cloud, no telemetry.

## Quick start

```sh
# 1. Initialize a .substrate/ in your project
npx @diegoferreyra/substrate init

# 2. Inspect it in your browser (http://localhost:7475)
npx @diegoferreyra/substrate serve

# 3. Let your agent drive it — add the MCP server to your agent runtime's config
```

MCP config (e.g. Claude Code / any MCP-compatible runtime):

```json
{
  "mcpServers": {
    "substrate": {
      "command": "npx",
      "args": ["@diegoferreyra/substrate", "mcp"]
    }
  }
}
```

Other commands: `substrate backup`, `substrate export <path>`, `substrate import <path>`, `substrate diagnose` (prints environment + substrate health — include its output in bug reports). Run `npx @diegoferreyra/substrate --help` for the full list.

## How it works

- **Substrate-as-code.** `.substrate/boards/*.json` define boards, groups, custom `field_schema`, and policies. They are read fresh on every call — edit the JSON (or use the substrate-edit MCP tools) and the change takes effect immediately. No migration, no cascade.
- **Runtime state in SQLite.** Tasks, comments, and the append-only event log live in `.substrate/data.sqlite` (libsql, WAL mode — safe for concurrent agents).
- **Two policy classes (v1).** `transition_guard` (block disallowed group transitions) and `agent_responsibility` (attach suggestions to matching writes). Every write returns an envelope listing the policies that fired.
- **One read-only web UI.** `substrate serve` hosts a localhost-only inspector (project → boards → board detail → task detail with comments and history). Author-supplied markdown is rendered through a single sanitized path.

## Supported platforms

- **macOS and Linux** — primary, CI-tested.
- **Windows / WSL** — best-effort. CI runs the Windows matrix leg (visible, non-blocking); WSL is the recommended path on Windows. See [SUPPORT.md](SUPPORT.md).

Requires **Node.js ≥ 20**.

## Examples

See [`examples/`](examples/) — real example substrates land as the project dogfoods.

## Contributing & support

- Bugs with a reproduction are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).
- Support model (solo project, weekly triage, no SLAs) — see [SUPPORT.md](SUPPORT.md).
- Changes are tracked in [CHANGELOG.md](CHANGELOG.md).

## License

MIT — see [LICENSE](LICENSE). Copyright (c) 2026 Diego Ferreyra.
