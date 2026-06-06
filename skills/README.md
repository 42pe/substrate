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

### Install it (one time)

Make the skill available in **every** project by copying it into your user
skills directory:

```sh
# from the Substrate repo
mkdir -p ~/.claude/skills
cp -R skills/substrate ~/.claude/skills/substrate
```

Or install it per-project into `<project>/.claude/skills/substrate/`.

Then, in any project, just tell your agent:

> Set up Substrate here and start tracking our work in it.

The skill triggers, performs setup, and from then on uses Substrate's MCP tools
by the conventions it describes. See [`../README.md`](../README.md#using-substrate-with-a-coding-agent)
for the full walkthrough, including the one-time global-link install needed
while Substrate is still private/unpublished.
