# Skills

Agent skills that ship with Substrate. A skill teaches a coding agent (Claude
Code and other skill-aware runtimes) how to set up and drive Substrate
**autonomously** — so you can open a project and say *"track our work in
Substrate"* and the agent takes it from there.

## `substrate/`

The one skill you need. It encodes both halves of onboarding:

- **Setup** — register the MCP server in the project's `.mcp.json`, run
  `substrate init`, and leave a `CLAUDE.md` pointer for future sessions.
- **Usage** — the workflow and conventions: call `whoami` first, the
  substrate-as-code model, the task/comment lifecycle, optimistic-concurrency
  updates, and how to read the policy envelope.
- **Authoring** ([`substrate/AUTHORING.md`](substrate/AUTHORING.md)) — how to
  build a substrate that mirrors a development process: the policy DSL (which the
  MCP tool schemas don't document) and the process→substrate mapping recipe, so
  an agent can turn a team's workflow into enforceable gates.

### Install it

**Easiest — let the agent install it.** Point your agent at the repo once and it
self-installs the skill (and sets everything else up):

> Read `<path-to-substrate-repo>/AGENTS.md` and set up Substrate in this project.

See [`../AGENTS.md`](../AGENTS.md). After that first run the skill lives in
`~/.claude/skills/` and auto-triggers in every project.

**By hand** — copy it into your user skills directory (available everywhere) or a
project's `.claude/skills/`:

```sh
# from the Substrate repo
mkdir -p ~/.claude/skills && cp -R skills/substrate ~/.claude/skills/substrate
```

Either way, once installed you just tell your agent _"track our work in
Substrate"_ and it drives the MCP tools by the conventions in `substrate/SKILL.md`.
See [`../README.md`](../README.md#using-substrate-with-a-coding-agent) for the
full walkthrough.
