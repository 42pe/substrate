# Substrate

**Keep your development process out of the agent's head.** When you orchestrate coding agents, the workflow — what's specced, what's approved, which gates aren't met yet — lives in your head or in a `CLAUDE.md` the agent drifts away from as its context fills. **Substrate** is a per-project, agent-collaborative work tracker (an in-repo "project memory" over **MCP**): you define the process once as data, and every agent — this session or the next — reads the same durable state from `.substrate/` and is held to the same gates at write time. The agent spends its context on the work, not on re-deriving where things stand.

It's a single npm binary in your repo. Agents read and write boards, tasks, comments, and policies over a stdio MCP server; you inspect the same data in a local web UI (a live kanban). Everything is local — a JSON "substrate-as-code" definition of boards/groups/fields/policies plus a local SQLite database of runtime state, beside your code. No accounts, no cloud, no telemetry.

> _Not the [Polkadot Substrate](https://substrate.io/) blockchain framework — this is an **agent task manager / MCP work-tracker** for coding agents._

## Why not TodoWrite, a `CLAUDE.md` file, or GitHub Issues?

Two things those can't do, which are the whole reason Substrate exists:

- **State that survives the context window.** Harness-native todo lists are per-session — they evaporate when the context resets; a markdown file is durable but unstructured. Substrate's state lives in `.substrate/`, so a new session (or a second agent) reads exactly where work stands and which gates are unmet without re-deriving it from `git log`. For one agent across many sessions this is the everyday payoff; for multiple agent teams on one repo it's the coordination layer.
- **Enforcement at the moment of the action.** A `CLAUDE.md` convention is advisory — agents drift from it as context fills. A `transition_guard` returns `transition_blocked` at the instant of the violating write, with perfectly-timed feedback. (Honest caveat: the gate checks a self-attested field — see [What gates do and don't do](#what-gates-do-and-dont-do).)

Substrate is runtime-agnostic, in-repo, version-controlled, and inspectable through a UI — the bet for why it stays useful even as harnesses ship native task lists.

## Quick start

```sh
# 1. Initialize a .substrate/ in your project (blank, or seed a starter board)
npx @diegoferreyra/substrate init
npx @diegoferreyra/substrate init --template web-delivery   # opt-in starter board

# 2. Inspect it in your browser (http://localhost:7475)
npx @diegoferreyra/substrate serve

# 3. Let your agent drive it — add the MCP server to your agent runtime's config

# (optional) Write a self-contained HTML map of the substrate:
npx @diegoferreyra/substrate explain   # → ./substrate-explain.html
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

Other commands: `substrate backup`, `substrate export <path>`, `substrate import <path>`, `substrate diagnose` (prints environment + substrate health — include its output in bug reports), `substrate logs [--errors]` (prints recent error-log lines — useful for bug reports). Run `npx @diegoferreyra/substrate --help` for the full list.

The long-lived `mcp`/`serve` processes record warnings and errors to `.substrate/logs/substrate.log` (gitignored, local-only) so a problem is diagnosable after the fact.

> **Pre-release note.** Substrate isn't published to npm yet, so `npx @diegoferreyra/substrate` won't resolve. Until it ships, use a local global link (see [Using Substrate with a coding agent](#using-substrate-with-a-coding-agent) below) — the `substrate` command then works the same everywhere.

## How it works

- **Substrate-as-code.** `.substrate/boards/*.json` define boards, groups, custom `field_schema`, and policies. They are read fresh on every call — edit the JSON (or use the substrate-edit MCP tools) and the change takes effect immediately. No migration, no cascade.
- **Runtime state in SQLite.** Tasks, comments, and the append-only event log live in `.substrate/data.sqlite` (libsql, WAL mode — safe for concurrent agents).
- **Two policy classes (v1).** `transition_guard` (block disallowed group transitions) and `agent_responsibility` (attach suggestions to matching writes). Every write returns an envelope listing the policies that fired.
- **One read-only web UI.** `substrate serve` hosts a localhost-only inspector. Boards render as a **live kanban** — columns by workflow group, with a List view a click away — and the Overview shows every board as a wall you can scan at once. It **auto-refreshes**, so when an agent moves a task between groups the board reflects it within seconds (the UI only observes — it never writes; there's no drag-and-drop). Author-supplied markdown is rendered through a single sanitized path.

## What gates do and don't do

A `transition_guard` is a real, structural rail: it blocks a group transition when a required field isn't set and returns `transition_blocked` to the agent **at write time**. But the field it checks is **self-attested** — the agent sets `tests_passing: true` itself; nothing runs the tests. A gate is a *confession step*, not a control: it records the agent's claim and blocks until the claim is made, but it doesn't verify the claim is true. An agent that would skip review under pressure can also set the flag under pressure.

That's still useful — a perfectly-timed hard rail beats advisory prose an agent has drifted from — but it's worth being precise about. (Gates backed by **verifiable evidence** — command exit codes, CI status, file existence — is where enforcement becomes real; it's a roadmap item, not v1.)

## Using Substrate with a coding agent

Substrate is built to be driven by an AI coding agent (Claude Code or any
skill-aware, MCP-capable runtime). It can set _itself_ up almost autonomously.

**The one-sentence path — point your agent at this repo.** From the project you
want to track, tell your agent (with a clone checked out locally):

> Read `<path-to-substrate-repo>/AGENTS.md` and set up Substrate in this project.

The agent builds + links the binary, **installs the skill into `~/.claude/skills/`
so future sessions auto-trigger**, registers the MCP server in this project's
`.mcp.json`, runs `substrate init`, leaves a `CLAUDE.md` pointer, and confirms
with `whoami`. See [`AGENTS.md`](AGENTS.md). (The repo is private, so use the
local clone path — a `gh`-authenticated clone or a raw URL works once it's
public. Steps that touch global state — `pnpm link --global`, writing to
`~/.claude/` — the agent will call out before running.)

**After that first run**, the skill is installed, so in _any_ project you just
say:

> Track our work in Substrate.

and it takes over — driving Substrate's 29 MCP tools by a documented set of
conventions (`whoami` first, optimistic-concurrency updates, read the policy
envelope, …). The full guide is [`skills/substrate/SKILL.md`](skills/substrate/SKILL.md).

**Prefer to do it by hand?** Build + link once
(`pnpm build && pnpm link --global`), copy the skill
(`cp -R skills/substrate ~/.claude/skills/substrate`), and add the MCP server
with the config snippet in [Quick start](#quick-start). Once Substrate is on npm,
the link step goes away and the MCP command becomes
`npx @diegoferreyra/substrate mcp`.

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
