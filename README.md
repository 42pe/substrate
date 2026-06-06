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

> **Pre-release note.** Substrate isn't published to npm yet, so `npx @diegoferreyra/substrate` won't resolve. Until it ships, use a local global link (see [Using Substrate with a coding agent](#using-substrate-with-a-coding-agent) below) — the `substrate` command then works the same everywhere.

## How it works

- **Substrate-as-code.** `.substrate/boards/*.json` define boards, groups, custom `field_schema`, and policies. They are read fresh on every call — edit the JSON (or use the substrate-edit MCP tools) and the change takes effect immediately. No migration, no cascade.
- **Runtime state in SQLite.** Tasks, comments, and the append-only event log live in `.substrate/data.sqlite` (libsql, WAL mode — safe for concurrent agents).
- **Two policy classes (v1).** `transition_guard` (block disallowed group transitions) and `agent_responsibility` (attach suggestions to matching writes). Every write returns an envelope listing the policies that fired.
- **One read-only web UI.** `substrate serve` hosts a localhost-only inspector (project → boards → board detail → task detail with comments and history). Author-supplied markdown is rendered through a single sanitized path.

## Using Substrate with a coding agent

Substrate is built to be driven by an AI coding agent (Claude Code or any
skill-aware, MCP-capable runtime). The repo ships a **skill** that teaches an
agent to set itself up and use Substrate almost autonomously — so you can open a
project and say _"track our work in Substrate"_ and it takes over.

**One-time setup (while Substrate is private/unpublished):**

```sh
# 1. Build + globally link the binary (from the Substrate repo)
pnpm build && pnpm link --global      # `substrate` is now on your PATH

# 2. Install the skill for every project
mkdir -p ~/.claude/skills && cp -R skills/substrate ~/.claude/skills/substrate
```

**Then, in any project**, tell your agent:

> Set up Substrate here and start tracking our work in it.

The skill registers the MCP server in the project's `.mcp.json`, runs
`substrate init`, leaves a `CLAUDE.md` pointer for future sessions, and from
then on drives Substrate's 29 MCP tools by a documented set of conventions
(call `whoami` first, optimistic-concurrency updates, read the policy envelope,
etc.). See [`skills/`](skills/) and [`skills/substrate/SKILL.md`](skills/substrate/SKILL.md)
for the full skill, and register the MCP server manually with the config snippet
in [Quick start](#quick-start) if you prefer not to use the skill.

Once Substrate is published to npm, the global-link step goes away — the MCP
command becomes `npx @diegoferreyra/substrate mcp`.

## Supported platforms

- **macOS and Linux** — primary. Developed and tested here; the CI matrix covers them on every push.
- **Windows / WSL** — best-effort. The CI matrix includes a Windows leg (visible, non-blocking); WSL is the recommended path on Windows. See [SUPPORT.md](SUPPORT.md).

Requires **Node.js ≥ 20**.

## Examples

See [`examples/`](examples/) — real example substrates land as the project dogfoods.

## Contributing & support

- Bugs with a reproduction are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).
- Support model (solo project, weekly triage, no SLAs) — see [SUPPORT.md](SUPPORT.md).
- Changes are tracked in [CHANGELOG.md](CHANGELOG.md).

## License

MIT — see [LICENSE](LICENSE). Copyright (c) 2026 Diego Ferreyra.
