---
name: substrate
description: >-
  Set up and use Substrate — a local-first, agent-collaborative project/task
  manager exposed over MCP — inside a project. Use when the user wants to track
  work, tasks, boards, status, or project state in Substrate; when they ask to
  "set up Substrate" or "track this in Substrate"; or whenever the current
  project contains a `.substrate/` directory (that means Substrate is the
  project's source of truth for work tracking — read it before planning work).
---

# Substrate

Substrate is a local-first project-management substrate that you (the agent) and
the human share. Boards, groups, custom fields, and policies are
**substrate-as-code** (JSON in `.substrate/boards/*.json`, read fresh on every
call). Tasks, comments, and an append-only event log are **runtime state** in a
local SQLite DB. You operate it through an MCP server (29 tools); the human
inspects the same data at `http://localhost:7475` via `substrate serve`.

**If this project has a `.substrate/` directory, Substrate is the source of
truth for work. Call `whoami` first and reconcile your plan with what's there
before creating tasks or starting work.**

---

## Part 1 — Setup (only if Substrate isn't connected yet)

Do this once per project. Skip straight to Part 2 if `whoami` already works.

1. **Check state.** Is there a `.substrate/` dir? Is the `substrate` MCP server
   already connected (can you call `whoami`)? If both yes → go to Part 2.

2. **Ensure the binary is available.** Until Substrate is published to npm it is
   used from a local global link. If the `substrate` command is not on PATH, ask
   the human to run this once (in the Substrate repo, not this project):

   ```sh
   pnpm build && pnpm link --global
   ```

   (After Substrate ships to npm this whole step becomes
   `npx @diegoferreyra/substrate`.)

3. **Register the MCP server.** Merge this into the project's `.mcp.json`
   (create the file if absent; do NOT clobber other servers):

   ```json
   {
     "mcpServers": {
       "substrate": { "command": "substrate", "args": ["mcp"] }
     }
   }
   ```

4. **Initialize the substrate** (creates `.substrate/`, a starter board, and a
   `.gitignore` block):

   ```sh
   substrate init
   ```

5. **Tell the human to reload** so the MCP server connects (in Claude Code:
   restart the session or re-run MCP discovery). Then confirm with `whoami`.

6. **Leave a guide for future sessions.** Append a short pointer to the
   project's `CLAUDE.md` (create if absent) so every future agent session knows
   to use Substrate:

   ```md
   ## Substrate (work tracking)

   This project uses Substrate for task/project tracking (`.substrate/`). Call
   the `whoami` MCP tool first, reconcile your plan with existing boards/tasks
   before starting work, and record tasks/updates/comments there. See the
   `substrate` skill for conventions.
   ```

7. Optional: tell the human they can watch progress at
   `http://localhost:7475` via `substrate serve` (separate terminal).

---

## Part 2 — Using Substrate

### Always start with `whoami`

It returns the project, every board (with ids), and hints. Use it to orient
before any other call. Then `get_board_substrate` for the board you'll work in
(its groups, `field_schema`, and policies) and `list_tasks` to see open work.

### The model

- **Substrate-as-code** (edit via the substrate-edit tools, takes effect
  immediately): **boards** (a workspace), **groups** (categories within a board —
  status/owner/phase, your call), **field_schema** (custom fields tasks/comments
  may carry), **policies** (rules — see below).
- **Runtime state** (the day-to-day): **tasks** (belong to one group), **comments**
  (threaded, on tasks), and the **event log** (automatic history).

### Conventions — follow these on every write

- **`agent_name` is required on every write.** Pass a stable identifier for
  yourself (e.g. `"claude-code"`). It's an audit tag, not auth.
- **Updates use optimistic concurrency.** `update_task`/`update_group`/etc.
  require the `version` from your most recent read. If you get
  `version_mismatch`, **re-read, reconcile, retry** — never blindly overwrite.
- **Read before you write.** Resolve real board/group ids via `whoami` /
  `get_board_substrate`; don't guess ids.
- **`custom_data` merges key-by-key** on update; pass `null` for a key to delete
  it.
- **Every write returns an envelope:** `{ ok: true, applied: { entity, id,
  version, state }, policies_fired: [...] }`. **Read `policies_fired`** and act on
  it (see Policies). Keep the returned `version` for your next update.

### Typical loop

1. `whoami` → pick the board → `get_board_substrate` (groups + schema + policies).
2. `list_tasks` (filter by board/group) to see current work.
3. Create work: `create_task` (`board_id`, `group_id`, `title`, `agent_name`;
   optional `description` markdown, `custom_data`).
4. Progress work: `update_task` to move it between groups or edit fields (send
   only changed fields + `version` + `agent_name`).
5. Communicate: `add_comment` (markdown body) for decisions/notes;
   `get_task_history` to see what happened.
6. Shape the workspace when needed: `create_group`/`create_board`/`create_policy`
   etc. — but prefer reusing the existing structure over inventing new boards.

### Policies (read the envelope!)

- **`transition_guard`** can BLOCK a group move (e.g. "can't go to Done without
  review"). If a write is blocked, read the message, do the prerequisite, retry.
- **`agent_responsibility`** attaches a SUGGESTION to matching writes via
  `policies_fired`. Surface it to the human and/or act on it; don't ignore it.

### Don't

- Don't invent board/group ids — resolve them from reads.
- Don't skip `agent_name` or omit `version` on updates.
- Don't duplicate a board/group that already fits; extend the existing substrate.
- Don't treat a `transition_guard` block or an `agent_responsibility` suggestion
  as noise — they are the point of the system.

---

## Tool reference (29)

**Read (10):** `whoami`, `get_project`, `list_boards`, `get_board_substrate`,
`list_tasks`, `get_task`, `get_task_history`, `list_comments`, `get_comment`,
`reverse_captcha` (an easter egg — a timed puzzle, not part of normal work).

**Task & comment writes (7):** `create_task`, `update_task`, `archive_task`,
`unarchive_task`, `add_comment`, `edit_comment`, `archive_comment`.

**Substrate-edit — boards/groups/policies (12):** `update_project`,
`create_board`, `update_board`, `archive_board`, `unarchive_board`,
`create_group`, `update_group`, `reorder_groups`, `archive_group`,
`create_policy`, `update_policy`, `archive_policy`.

Each tool advertises its exact input schema via MCP `tools/list` — consult it
for required fields rather than guessing.
