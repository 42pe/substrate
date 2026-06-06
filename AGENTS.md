# AGENTS.md — bootstrap Substrate from this repo

**You are an AI agent a human pointed at the Substrate repository.** Your goal is
to set Substrate up as the work-tracking substrate for **their current project**
— _not_ for this repo — and to install the skill so future sessions can do this
automatically. Substrate is a local-first, agent-collaborative project/task
manager exposed over MCP (see [README.md](README.md)).

> **Target directory.** "Their project" = the directory the human is working in
> (your current working directory when they invoked you), which is almost
> certainly **not** this Substrate repo. If your cwd _is_ this repo, stop and ask
> the human which project to set up. Never run `substrate init` inside this repo.

> **Global actions.** A couple of steps below touch machine-global state
> (`pnpm link --global`, writing to `~/.claude/skills/`). Tell the human you're
> doing them; don't do them silently. Let `<REPO>` be the absolute path of this
> repository.

## Do this

1. **Make the `substrate` binary available.** Run `command -v substrate`. If it's
   missing, build + globally link it from this repo (announce it first):

   ```sh
   cd <REPO> && pnpm install && pnpm build && pnpm link --global
   ```

   (Once Substrate is published to npm this step disappears — the MCP command
   becomes `npx @diegoferreyra/substrate mcp`.)

2. **Self-install the skill** so this whole flow auto-triggers next time, in
   every project (idempotent — skip if already present):

   ```sh
   mkdir -p ~/.claude/skills && cp -R <REPO>/skills/substrate ~/.claude/skills/substrate
   ```

3. **Set Substrate up in the human's project + use it.** Follow
   [`skills/substrate/SKILL.md`](skills/substrate/SKILL.md): register the MCP
   server in the project's `.mcp.json`, run `substrate init` **in the project
   directory**, leave a `CLAUDE.md` pointer, have the human reload so the MCP
   server connects, and confirm with the `whoami` tool. That file is also your
   ongoing usage guide (conventions, the tool surface, the policy envelope).

After this, the human can just say _"track our work in Substrate"_ in any project
and the installed skill takes over.
