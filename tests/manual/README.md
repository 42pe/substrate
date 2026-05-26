# Manual MCP-client smoke

Phase 1 acceptance includes a real-MCP-client smoke test that the automated
integration tests can't fully cover. The Vitest integration suite spawns
`npx substrate mcp` as a child and speaks JSON-RPC over stdio using a
hand-rolled `StdioClient` — that proves our wire format is correct, but
doesn't prove that a _real_ agent runtime (Claude Code, MCP Inspector)
can negotiate, list, and call tools end-to-end.

This document is the recipe for running that smoke once per Phase 1
release. Outcome is recorded in `.agents/audits/phase-01-audit.md`.

## When to run

- Before merging `feature/phase-01-walking-skeleton` to `main`.
- After any change that touches `src/mcp/**`.

## What you need

- A built or `tsx`-runnable substrate at this branch.
- One of:
  - **MCP Inspector** (recommended for the smoke — it shows raw JSON
    responses and is fastest to set up): `npx @modelcontextprotocol/inspector`.
  - **Claude Code** with the ability to add MCP servers via `.mcp.json`.

## Procedure A — MCP Inspector

This is the canonical smoke. It exercises tool discovery and a real
`create_task` call without involving any LLM.

### 1. Initialize a test substrate

```sh
mkdir -p /tmp/substrate-mcp-smoke
cd /tmp/substrate-mcp-smoke
pnpm --dir /Users/diegoferreyra/WebDevelopment/substrate exec tsx \
  /Users/diegoferreyra/WebDevelopment/substrate/src/cli/index.ts init
```

You should see:

```
Substrate initialized in /tmp/substrate-mcp-smoke/.substrate
Next steps:
  ...
```

Verify `/tmp/substrate-mcp-smoke/.substrate/` contains `config.json`,
`boards/`, `attachments/`, and `data.sqlite`.

### 2. Launch the MCP Inspector against `npx substrate mcp`

From the repo (so `tsx` and deps are available):

```sh
cd /Users/diegoferreyra/WebDevelopment/substrate
npx @modelcontextprotocol/inspector \
  pnpm exec tsx src/cli/index.ts mcp
```

Set `--cwd /tmp/substrate-mcp-smoke` (or run the command from there) so
the spawned substrate child opens the test substrate, not the repo's.

The Inspector should open in your browser. After a moment, the server
panel should show:

- **Server name:** `substrate`
- **Server version:** `0.0.1`
- **Status:** Connected

If it stays "Connecting…" longer than ~5 seconds, the child failed.
Check stderr — most commonly the `.substrate/` is in the wrong cwd.

### 3. Verify `tools/list`

In the Inspector, switch to the **Tools** tab. You should see two tools:

- `create_task` — with a JSON schema showing required fields
  `board_id`, `group_id`, `title`, `agent_name` and optionals
  `parent_id`, `description`, `custom_data`.
- `whoami` — with no input arguments.

If either is missing, the registry wiring is broken.

### 4. Call `whoami`

Click `whoami` → **Run**. The result should be a `content` array with one
text block containing JSON like:

```json
{
  "project_id": "<uuid you saw at init>",
  "project_name": "substrate-mcp-smoke",
  "schema_version": 1,
  "phase": "v0.0.1 (walking skeleton)",
  "boards": [],
  "hints": []
}
```

`project_id` must match what `cat .substrate/config.json` shows.

### 5. Call `create_task`

Click `create_task` → fill in:

- `board_id`: `smoke-board`
- `group_id`: `smoke-group`
- `title`: `Hello from MCP Inspector`
- `agent_name`: `inspector-smoke`

Run. The result should be a `content` array containing a JSON envelope:

```json
{
  "ok": true,
  "applied": {
    "entity": "task",
    "id": "<a uuid>",
    "version": 1,
    "state": {
      "id": "<same uuid>",
      "board_id": "smoke-board",
      "group_id": "smoke-group",
      "title": "Hello from MCP Inspector",
      "version": 1,
      "created_by_agent": "inspector-smoke",
      ...
    }
  },
  "policies_fired": []
}
```

### 6. Verify persistence

In a separate terminal:

```sh
sqlite3 /tmp/substrate-mcp-smoke/.substrate/data.sqlite \
  "SELECT id, title, created_by_agent FROM tasks"
```

You should see exactly one row with the title and agent name you just
submitted.

### 7. Clean shutdown

Close the Inspector tab. The child `substrate mcp` should exit on
stdin close. Confirm there's no lingering process.

```sh
rm -rf /tmp/substrate-mcp-smoke
```

## Procedure B — Claude Code

If you don't have MCP Inspector handy, you can do an abbreviated smoke
through Claude Code itself.

### 1. Init substrate

Same as Procedure A, Step 1.

### 2. Add Substrate to Claude Code's MCP config

In your Claude Code's `.mcp.json` (project-level recommended for the
smoke):

```json
{
  "mcpServers": {
    "substrate-smoke": {
      "command": "pnpm",
      "args": [
        "--dir",
        "/Users/diegoferreyra/WebDevelopment/substrate",
        "exec",
        "tsx",
        "/Users/diegoferreyra/WebDevelopment/substrate/src/cli/index.ts",
        "mcp"
      ],
      "cwd": "/tmp/substrate-mcp-smoke"
    }
  }
}
```

### 3. Restart Claude Code so it picks up the MCP server.

### 4. In a Claude Code session, ask:

> "Use the substrate-smoke MCP server's whoami tool and show me the
> result, then create a task with board_id=smoke-board, group_id=smoke-group,
> title=hello-cc, agent_name=cc-smoke."

Verify:
- The whoami output shows project_name `substrate-mcp-smoke`.
- The create_task succeeds and returns an envelope with `ok: true`.
- `sqlite3 /tmp/substrate-mcp-smoke/.substrate/data.sqlite "SELECT title FROM tasks"`
  shows `hello-cc`.

### 5. Clean up

Remove the MCP entry from `.mcp.json`, restart Claude Code, delete the
test substrate dir.

## Recording outcome

In the Phase 1 audit (`.agents/audits/phase-01-audit.md`), under the
**Stage 4: QA** section, record:

```
[x] Real-MCP-client smoke performed via Procedure A (MCP Inspector)
    - tools/list:     PASS — both tools listed
    - whoami:         PASS — returned correct project_id
    - create_task:    PASS — envelope ok:true; row persisted in data.sqlite
    - clean shutdown: PASS — child exited on Inspector close
```

If any step fails, the audit MUST record the failure. A failing real-
MCP-client smoke is a Phase 1 acceptance blocker per spec §8.
