# Phase 1 Spec — Walking Skeleton + Security Floor + Version Stamp

**Status:** ✅ Approved 2026-05-09 (open questions resolved; ready for Phase 1 plan)
**Author:** Orchestrator (drafted directly; Spec Team analysts skipped for this bootstrap phase per workflow.md small/clear-scope rule)
**Last updated:** 2026-05-09
**Parent plan:** [`../v1-architecture.md`](../v1-architecture.md) §5 Phase 1
**Workflow:** [`../../workflow.md`](../../workflow.md)

---

## 1. Scope

Establish the project skeleton (repo bootstrap, tooling, build) and ship the minimum vertical slice that verifies the architecture composes end-to-end: HTTP server, stdio MCP server, libsql connection, schema-version-stamped SQLite via a minimal migration runner, security middleware floor, three CLI commands, and one MCP tool (`create_task`). Plus a minimal `whoami` so MCP handshake is complete.

This phase also sets the engineering conventions all later phases inherit: connection PRAGMAs, error envelope shape, CLI behavior, security middleware mounting, TypeScript strictness.

## 2. Goals

- Fresh clone → `pnpm install && pnpm build && pnpm test` all green.
- A real MCP client (Claude Code, MCP Inspector) can connect to `npx substrate mcp` and successfully call `create_task`.
- HTTP server boots; health route returns 200; Origin/Host rejection works.
- 4 concurrent processes (1 HTTP server + 3 stdio MCP children) hammer SQLite for 60s with zero failures (validates Phase 0 finding holds in real code, not just the spike).
- Atomic-write pattern is exercised against `.substrate/` paths (preparation for Phase 4's substrate-edit tools).
- All architecture's load-bearing claims for the *bootstrap layer* are smoke-tested.

## 3. Detailed behavior

### 3.1 Repository setup

Files created in Phase 1:
- `package.json` — pnpm, type=module, bin field, scripts.
- `tsconfig.json` (root, IDE-facing) + `tsconfig.build.json` (server build target).
- `eslint.config.js` — flat config, TypeScript-ESLint, `import/no-cycle` enabled.
- `.prettierrc` — defaults; 100-char width.
- `vitest.config.ts` — Node environment, fixtures path, coverage settings.
- `.gitignore` — `node_modules/`, `dist/`, `.substrate/data.sqlite*`, `.substrate/attachments/`, OS junk.
- `README.md` — placeholder (full README is Phase 6).
- `LICENSE` — MIT, copyright Diego Ferreyra (full text). *(Superseded 2026-09-06: Apache-2.0 — see `decisions.md` “Licensing (2026-09-06)”.)*
- `CHANGELOG.md` — `## v0.0.1 — Phase 1 internal milestone` entry.
- `.gitattributes` — `* text=auto eol=lf`.

Directory skeleton:
- `src/core/`, `src/storage/`, `src/storage/migrations/`, `src/substrate/`, `src/policy/` (empty), `src/mcp/`, `src/mcp/tools/write/`, `src/http/`, `src/http/middleware/`, `src/cli/`, `src/cli/commands/`, `src/shared/`.
- `ui/` (separate Vite root, minimal).
- `tests/`, `tests/integration/`, `tests/smoke/`, `tests/fixtures/`, `tests/helpers/`.
- `.agents/plans/`, `.agents/audits/` (already exist).

### 3.2 CLI

CLI entry: `src/cli/index.ts` (compiled to `dist/server/cli/index.js`, registered as `bin`).

#### `npx substrate init`

Behavior:
1. If `.substrate/` exists in cwd: refuse with stderr error: `"A .substrate/ directory already exists here. To re-initialize, back up and remove it first."` Exit 1.
2. Create directory tree under `.substrate/`:
   - `boards/` (empty)
   - `attachments/` (empty)
3. Create `.substrate/config.json`:
   ```json
   {
     "project_id": "<uuid-v4 via crypto.randomUUID()>",
     "project_name": "<basename of cwd>",
     "schema_version": 1,
     "created_at": "<ISO-8601 UTC>"
   }
   ```
4. Create `.substrate/data.sqlite`:
   - Open with libsql (`createClient({ url: 'file:...' })`)
   - Set `PRAGMA journal_mode = WAL`
   - Set `PRAGMA synchronous = NORMAL`
   - Run migration 001 inside a transaction
   - Set `PRAGMA user_version = 1` at end of migration
5. Append to `.gitignore` (creating if missing):
   ```
   # Substrate runtime state (per-machine)
   .substrate/data.sqlite
   .substrate/data.sqlite-wal
   .substrate/data.sqlite-shm
   .substrate/substrate.pid
   .substrate/attachments/
   ```
6. Print human-readable summary:
   ```
   Substrate initialized in <cwd>/.substrate
     - project_id: <uuid>
     - project_name: <name>
     - schema_version: 1
   
   Next steps:
     1. Edit .substrate/boards/<your-board>.json (or ask an agent via MCP)
     2. Start the substrate: npx substrate serve
     3. Configure your agent runtime to spawn: npx substrate mcp
   ```
7. Exit 0.

Flags: `--no-starter-board` is reserved but a no-op in Phase 1 (no starter board is created at all yet — that's a v1.x convenience).

#### `npx substrate serve` (alias: default `npx substrate`)

Behavior:
1. Locate `.substrate/`: cwd must contain it. If missing, refuse with stderr error: `"No .substrate/ in this directory. Run 'npx substrate init' first."` Exit 1.
2. Read `.substrate/config.json`. Validate shape; refuse with clear error if malformed.
3. Open libsql connection to `.substrate/data.sqlite`.
4. Set `PRAGMA busy_timeout = 5000` (Substrate convention).
5. Read `PRAGMA user_version`. If > binary's expected schema version: refuse with stderr error: `"This .substrate/data.sqlite was written by a newer Substrate (schema v<n>). Upgrade to that version or restore from backup."` Exit 1.
6. Check for `.substrate/substrate.pid`:
   - If file exists, read PID, check `process.kill(pid, 0)`:
     - If process alive: refuse with stderr: `"Substrate is already running here (pid <n>). Stop it first."` Exit 1.
     - If process dead (ESRCH): reclaim — delete stale file.
   - If file does not exist: continue.
7. Bind Hono server to `127.0.0.1:7475`:
   - If `EADDRINUSE`: refuse with stderr error mentioning the port + that another process holds it. Identifying the holder is best-effort (deferred).
8. Write current PID to `.substrate/substrate.pid`.
9. Mount routes (see §3.3) through security middleware (see §3.4).
10. Print `Substrate running on http://localhost:7475 (pid <n>)`.
11. Install SIGINT/SIGTERM handlers: on signal, remove PID file, close SQLite connection, exit 0.

Flags: `--port <n>` is reserved but not implemented in Phase 1 (port is pinned to 7475 per PRD).

#### `npx substrate mcp`

Behavior:
1. Locate `.substrate/`: cwd must contain it. If missing, stderr error + exit 1.
2. Read `.substrate/config.json`.
3. Open libsql connection; set `PRAGMA busy_timeout = 5000`.
4. Verify `PRAGMA user_version` ≤ expected (same as `serve`).
5. Start MCP server via `@modelcontextprotocol/sdk`'s `Server` + `StdioServerTransport`.
6. Register tools: `create_task`, `whoami` (see §3.5).
7. On stdin close: clean shutdown.

Does NOT write a PID file (multiple stdio MCP children co-exist by design).

#### `npx substrate --help` / `<command> --help`

Standard help output with brief description, usage, flags. Auto-generated from CLI command definitions.

### 3.3 HTTP routes (Phase 1)

| Method | Path | Handler |
|---|---|---|
| GET | `/api/health` | returns `{ ok: true, version: "<from package.json>", schema_version: 1, uptime_ms: <int> }` |
| GET | `/*` | static fallback: if Phase 1 UI build exists in `dist/ui/`, serve it; otherwise return a simple HTML page with text "Substrate is running. UI ships in Phase 5." |

All routes pass through:
- Origin/Host allowlist middleware (rejects → 403)
- Path canonicalization middleware (mounted but no-op in Phase 1; real check kicks in when attachment-serving routes land)
- Error handler middleware (catches uncaught, returns JSON envelope)

### 3.4 Security middleware

#### `src/http/middleware/origin-allowlist.ts`

For every HTTP request:
- If `Origin` header is absent (curl, server-to-server): allow.
- If `Origin` is in `["http://localhost:7475", "http://127.0.0.1:7475"]`: allow.
- Otherwise: 403 with envelope:
  ```json
  {
    "ok": false,
    "error": {
      "code": "forbidden",
      "message": "Origin not allowed",
      "details": { "origin": "<reflected>" }
    }
  }
  ```
- Independently, if `Host` header is set and not in `["localhost:7475", "127.0.0.1:7475"]`: same 403 (defeats DNS rebinding).

#### `src/http/middleware/path-canonical.ts`

Phase 1 ships the file with the canonical-path-check function exported, but mounts it as a no-op (since no routes serve user-controlled file paths in Phase 1). Used by attachment-serving routes in later phases. Reason for shipping early: forces the security pattern into the codebase before any vulnerable surface exists.

#### `src/http/middleware/error-handler.ts`

Wraps all routes. Catches:
- `SubstrateError` instances: maps to error envelope with appropriate HTTP status.
- Anything else: logs (scrubbed), returns 500 with `{ ok: false, error: { code: "internal_error", message: "Internal error" } }` — never reflects internal error messages to the client.

### 3.5 MCP tools (Phase 1)

#### `create_task`

Input schema (JSON Schema, exposed via MCP `tools/list`):
```json
{
  "type": "object",
  "required": ["board_id", "group_id", "title", "agent_name"],
  "properties": {
    "board_id":    { "type": "string", "minLength": 1 },
    "group_id":    { "type": "string", "minLength": 1 },
    "parent_id":   { "type": "string" },
    "title":       { "type": "string", "minLength": 1 },
    "description": { "type": "string" },
    "custom_data": { "type": "object" },
    "agent_name":  { "type": "string", "minLength": 1 }
  }
}
```

Behavior:
1. Validate input against schema. On failure: return error envelope with code `schema_violation`.
2. Generate `id` via `crypto.randomUUID()`.
3. Set `version = 1`, `created_at = updated_at = new Date().toISOString()`.
4. Insert into `tasks` table.
5. Return success envelope:
   ```json
   {
     "ok": true,
     "applied": {
       "entity": "task",
       "id": "<uuid>",
       "version": 1,
       "state": { /* full task as stored */ }
     },
     "policies_fired": []
   }
   ```
   - `policies_fired` is always `[]` in Phase 1 (no policy engine).

Phase 1 explicitly does NOT validate:
- `board_id` actually references a board (no boards in Phase 1).
- `group_id` actually references a group (same).
- `custom_data` matches a `field_schema` (no schema validation until Phase 2).

These are temporary holes that close in Phase 2.

#### `whoami`

Input schema: `{}` (no parameters).

Behavior:
- Returns:
  ```json
  {
    "project_id": "<from config.json>",
    "project_name": "<from config.json>",
    "schema_version": 1,
    "phase": "v0.0.1 (walking skeleton)",
    "boards": [],
    "hints": []
  }
  ```
- `boards: []` because Phase 1 doesn't load `boards/*.json` yet.
- `hints: []` because easter egg ships in Phase 3.
- Existence of `hints` field in Phase 1 (empty) is intentional — establishes the shape that Phase 3 populates.

### 3.6 Schema — Migration 001 (Phase 1)

```sql
-- Run inside a single transaction by the migration runner.

CREATE TABLE tasks (
  id                TEXT PRIMARY KEY,
  board_id          TEXT NOT NULL,
  group_id          TEXT NOT NULL,
  parent_id         TEXT,
  origin_task_id    TEXT,
  title             TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',
  custom_data       TEXT NOT NULL DEFAULT '{}',     -- JSON
  version           INTEGER NOT NULL DEFAULT 1,
  created_by_agent  TEXT NOT NULL,
  created_at        TEXT NOT NULL,                  -- ISO-8601 UTC
  updated_at        TEXT NOT NULL,
  archived_at       TEXT
);

CREATE INDEX idx_tasks_board_id    ON tasks(board_id);
CREATE INDEX idx_tasks_group_id    ON tasks(group_id);
CREATE INDEX idx_tasks_parent_id   ON tasks(parent_id);
CREATE INDEX idx_tasks_archived_at ON tasks(archived_at);

PRAGMA user_version = 1;
```

`PRAGMA journal_mode = WAL` and `PRAGMA synchronous = NORMAL` are set during `init`, not as part of migration 001 (they're per-file settings that persist in the file header).

Phase 1 schema does NOT include: `comments`, `task_events`, or any other table. Those land with migration 002 in Phase 2.

### 3.7 Migration runner

Location: `src/storage/migrations/runner.ts`.

Behavior:
1. Discovers migrations at compile time from `src/storage/migrations/` (files named `0NN-<slug>.ts`, each exporting `{ id: number, up: (db) => Promise<void> }`).
2. Reads current `PRAGMA user_version`.
3. If current > max(migrations.id): refuse (see CLI behavior).
4. For each migration with `id > current`, in id order:
   - Open a transaction.
   - Call `migration.up(db)`.
   - Set `PRAGMA user_version = migration.id`.
   - Commit.
   - On error: transaction rolls back; abort the runner; error propagates.
5. Backup-before-migration logic is **deferred to Phase 4** (when migration 002 exists to exercise the multi-migration path). Phase 1's runner has just the structure — version check + transactional apply — without the backup step.

### 3.8 Logger

`src/shared/logger.ts` — thin console wrapper:
- `logger.info(msg, ctx?)` / `logger.warn` / `logger.error`.
- Scrubs `agent_name` from context by default (treat as untrusted): if `ctx.agent_name` is present, sanitize for safe terminal output (strip control chars, truncate to 100 chars, surround with brackets).
- No structured logging in Phase 1; reconsider `pino` in v1.x.

### 3.9 UI bootstrap (minimum)

In `ui/`:
- `package.json` with Vite + React + TypeScript + Tailwind v4 deps.
- `vite.config.ts` — builds to `dist/ui/`.
- `index.html`.
- `src/main.tsx` — renders `<App />`.
- `src/App.tsx` — single page that reads from `/api/health` and displays "Substrate is running" + project name + version.
- `src/styles.css` — Tailwind v4 `@import 'tailwindcss';`.
- `tailwind.config.ts`.

Phase 1 does NOT include:
- TanStack Router (Phase 5).
- ShadCN setup (Phase 5).
- Any route beyond the root page.

The UI bootstrap proves Vite + Tailwind v4 compose with our build pipeline. ShadCN and routing wait until Phase 5 where we actually build the inspector.

## 4. Tests (Phase 1)

### Unit tests (Vitest)
- `core/types`: type smoke.
- `core/errors`: SubstrateError construction, code mapping.
- `core/envelope`: success/error envelope construction.
- `storage/migrations/runner`: applies migrations in order; refuses if file version > binary; transaction rollback on simulated failure.
- `storage/repositories/tasks`: CRUD against an in-memory SQLite.
- `substrate/loader`: parses a valid config.json fixture; rejects malformed.
- `http/middleware/origin-allowlist`: accepts allowed origins; rejects others; rejects bad Host.
- `shared/logger`: agent_name sanitization.
- `cli/commands/init`: integration-style test that creates a temp dir, runs init, asserts files exist + content is correct.

### Integration tests (Vitest, real subprocess)
- `tests/integration/mcp-create-task.test.ts`: spawns `npx substrate mcp` as child, sends `tools/list` and `tools/call` JSON-RPC, asserts response shapes and SQLite state.
- `tests/integration/http-health.test.ts`: starts the Hono server in-process, fetches `/api/health`, asserts response.

### Smoke tests (Vitest with `pnpm test:smoke:*` scripts)
- `tests/smoke/concurrency.test.ts`: spawns 1 serve + 3 mcp children, all writing for **60s** (matches the Phase 0 spike that already proved clean behavior). Zero errors required.
- ~~`tests/smoke/atomic-write.test.ts`~~ — **deferred to Phase 4** (Architect Reviewer's concern #2: shipping `src/substrate/writer.ts` as a stub for a future-phase smoke test violates Phase 1 scope per §7 "Substrate-edit tools out of scope"). Phase 4 owns both the writer implementation and its smoke test.

### Real-MCP-client manual check
- Documented in README of `tests/manual/` (created in Phase 1): step-by-step for connecting MCP Inspector or Claude Code to `npx substrate mcp` and verifying `create_task`. Run once at end of Phase 1; record outcome in audit.

### What's NOT tested in Phase 1
- Real-MCP-client connection in CI (manual only — automating MCP-Inspector via CI is its own project).
- Windows-specific behavior (CI matrix is Phase 6; Phase 1 tests run on the developer's machine + CI gets enabled in Phase 6).
- Cross-platform atomic-rename (deferred to Phase 4 + Phase 6 CI).

## 5. Edge cases

| Scenario | Expected behavior |
|---|---|
| `substrate init` in dir with existing `.substrate/` | Refuse with clear error; suggest backup + remove |
| `substrate init` in read-only dir | Hono/fs ENOTPERM bubble up as `internal_error`; CLI prints helpful "Check directory permissions" |
| `substrate serve` when `.substrate/` doesn't exist | Refuse with clear error; suggest `init` |
| `substrate serve` when port 7475 is taken | Refuse with clear error mentioning the port |
| `substrate serve` with stale PID file (process dead) | Reclaim and proceed |
| `substrate serve` with active PID file (process alive) | Refuse with clear error |
| `substrate serve` when `data.sqlite` is corrupt | libsql error bubbles up; CLI prints "Database appears corrupt. Restore from backup or remove .substrate/ and re-init." |
| `substrate serve` with `user_version > 1` | Refuse with version-mismatch error |
| Ctrl-C during `substrate serve` | Clean shutdown via SIGINT handler |
| `substrate mcp` when `.substrate/` missing | Stderr error; exit non-zero |
| `create_task` missing `agent_name` | Error envelope: `schema_violation` |
| `create_task` with empty `title` | Error envelope: `schema_violation` |
| HTTP request with `Origin: https://evil.com` | 403 with `forbidden` code |
| HTTP request with `Host: external.com` | 403 with `forbidden` code |
| HTTP request with no Origin (curl) | Allowed |
| Concurrent `create_task` calls from 4 processes | All succeed (validated by smoke test) |

## 6. Resolved decisions (2026-05-09, Diego)

1. **Error code `forbidden`** — ✅ added to v1 error codes. PRD §6.4 updated.
2. **Minimal `whoami` in Phase 1** — ✅ included (project_id, project_name, schema_version, empty boards, empty hints).
3. **Formatter: Prettier 3.x + ESLint 9 flat config** — ✅ locked. Biome reconsidered in v1.x if needed.
4. **TypeScript strictness** — ✅ locked: `"strict": true`, `"noUncheckedIndexedAccess": true`, `"exactOptionalPropertyTypes": true`, `"module": "nodenext"`, `"target": "ES2022"`, `"moduleResolution": "nodenext"`, `"verbatimModuleSyntax": true`, `"isolatedModules": true`.
5. **Backup-before-migration** — ✅ deferred to Phase 4 per v1-architecture plan. Phase 1 runner has version-check + transactional apply only.

## 7. Out of scope (Phase 1)

- All MCP tools except `create_task` and minimal `whoami`.
- Entities other than Task: Comment, TaskEvent, Board, Group, Policy.
- Policy engine.
- `field_schema` validation.
- `update_task`, `archive_task`, `unarchive_task`, comment tools (Phase 2).
- Substrate-edit tools (Phase 4).
- Substrate JSON loading beyond `config.json` (Phase 2 loads `boards/*.json`).
- Web UI beyond a hello-world that proves Vite + Tailwind build.
- Hono JSON API beyond `/api/health` (Phase 5 mirrors MCP reads).
- TanStack Router, ShadCN (Phase 5).
- Attachment serving + real path canonicalization (post-Phase 1).
- Multiple migrations + backup (Phase 4).
- Easter egg `reverse_captcha` (Phase 3 stub, Phase 6 full).
- Windows / Linux CI (Phase 6).
- npm publish / OSS artifacts (Phase 6).

## 8. Acceptance criteria

- Fresh clone → `pnpm install && pnpm build && pnpm test` all green on macOS arm64 (Diego's primary).
- `npx substrate init` from a fresh dir creates `.substrate/` with stamped `data.sqlite` and updated `.gitignore`.
- `npx substrate serve` starts; `curl http://localhost:7475/api/health` returns 200.
- `curl -H "Origin: https://evil.com" http://localhost:7475/api/health` returns 403 with `forbidden` code.
- `curl -H "Host: external.com" http://localhost:7475/api/health` returns 403.
- `npx substrate mcp` started as child; JSON-RPC `tools/list` returns `create_task` and `whoami`; `tools/call create_task` persists; row visible via direct SQLite query.
- **Real-MCP-client smoke (manual, recorded in audit):** MCP Inspector or Claude Code connects to `npx substrate mcp`, calls `create_task`, sees the response.
- **Concurrency smoke (`pnpm test:smoke:concurrency`):** 4 processes, 60s, zero errors. (Atomic-write smoke deferred to Phase 4.)
- **Lifecycle:** Two `npx substrate serve` from same dir → second refuses cleanly. Ctrl-C cleans up PID file.
- **Schema guard:** Manually bumping `PRAGMA user_version` to 999 → serve refuses with clear error.
- `pnpm lint`, `pnpm format:check`, `tsc --noEmit` all clean.

## 9. Definition of Done (for this spec)

This spec is approved by Diego when:
- Open questions §6.1–6.4 resolved.
- Acceptance criteria §8 agreed.

Then per workflow.md Stage 2: Architect drafts Phase 1 plan → Architect Reviewer reviews → revision → Diego approves plan → development begins.
