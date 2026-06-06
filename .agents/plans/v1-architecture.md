# Substrate v1 — Architecture & Implementation Plan

**Status:** Revised v1.1 (post Architect Reviewer pass — pending Diego's approval)
**Author:** Architect (revised after review)
**Last updated:** 2026-05-09
**Spec:** [`../../prd.md`](../../prd.md) (PRD v0.3 serves as the spec for this plan)
**Workflow:** [`../workflow.md`](../workflow.md)
**Review notes:** Architect Reviewer found CONCERN on 5 sections; 12 specific recommendations incorporated.

> **Scope of this plan.** This is the overarching v1 architecture and implementation plan. It defines the repository structure, module boundaries, implementation phases (sequenced for solo build), test strategy, and acceptance criteria for v1. **This document does NOT substitute for per-phase plans.** Each implementation phase below will go through workflow.md's Stage 1 (Spec) and Stage 2 (Plan), producing `.agents/plans/specs/phase-{N}-spec.md` and `.agents/plans/phase-{N}-{slug}.md` before its development begins.

---

## 1. Overview

Implement Substrate v1 per PRD v0.3: a local-first, per-project TypeScript binary distributed via npm (`@diegoferreyra/substrate`) that exposes an MCP server (stdio) for agents and a local web UI for human inspection. Two policy classes in v1 (`transition_guard` + `agent_responsibility`), stdio MCP only, OSS from day one (MIT, public GitHub).

The build sequences as **seven implementation phases** (revised from 6 in v1.0 after Phase 2 split):

0. **Phase 0: Pre-build spike** (~1 day) — de-risk the load-bearing architectural assumption: libsql WASM running cleanly in both an HTTP server process and a stdio MCP child process simultaneously.
1. **Phase 1: Walking skeleton + security floor + version stamp** (~1–1.5 weeks) — bootstrap the repo, ship the security middleware, version-stamp the SQLite file, ship a minimal migration runner.
2. **Phase 2: Storage + reads + writes** (~2–3 weeks) — full SQLite schema, all read tools, all singleton write tools, `field_schema` validation, TaskEvents, OCC. **No policy engine yet.**
3. **Phase 3: Policy engine + envelope** (~1.5–2 weeks) — `transition_guard` + `agent_responsibility` classes, operator set, evaluator, response envelope with `policies_fired`, `whoami` (with easter-egg hint), stub `reverse_captcha`.
4. **Phase 4: Substrate-edit tools + lifecycle** (~1.5–2 weeks) — substrate-edit MCP tools with atomic JSON writes + version CAS, multi-migration testing + auto-backup, PID file + port pinning, `substrate diagnose`/`backup`/`export`/`import` CLIs.
5. **Phase 5: Web UI** (~3–4 weeks) — React/Vite/Tailwind/ShadCN/TanStack Router read-only inspector, Hono JSON API mirroring MCP reads, UI-side markdown sanitization, one Playwright smoke test. Substrate inspector page is stretch, not core.
6. **Phase 6: OSS artifacts + polish** (~1–1.5 weeks) — README, ISSUE_TEMPLATE, SUPPORT, CONTRIBUTING, examples placeholder, GitHub Actions CI (matrix: Ubuntu + macOS + Windows-best-effort), npm publishing setup, full `reverse_captcha` easter egg.
7. **Phase 7: Dogfood init** (open-ended) — `substrate init` on first dogfood project; 8-week dogfood window opens.

**Total: ~10–14 weeks of focused build at 8–20 hrs/week solo** (revised up from v1.0's 8–11 weeks based on reviewer pushback on Phase 2 and Phase 5 sizing). At 8 hrs/week that's ~6 calendar months; at 20 hrs/week that's ~2.5 months. This is the build budget; v1 dogfood window of 8 weeks sits on top.

## 2. Goals & Non-Goals

Inherited from PRD §3. Summary for this plan:

**Goals:**
- All v1 functional requirements (PRD §6) implemented and tested.
- All v1 security middleware (PRD §6.4) in place — *as of Phase 1, not deferred to UI phase*.
- All v1 OSS artifacts shipped (PRD §6.16) before public push.
- `npx @diegoferreyra/substrate init` works on macOS and Linux (Windows best-effort, CI-visible).
- v1 ships in a state where Diego can use it on **≥2 real projects** (aligning with PRD §3 dogfood targets).

**Non-goals (for this plan):**
- Performance optimization beyond what's needed for v1 scale (thousands of tasks).
- Polished UX beyond "functional and not embarrassing."
- Cross-platform parity for Windows in v1 (best-effort only; documented; CI runs but does not block).
- Test coverage of every code path; target ≥80% on `core/`, `policy/`, `storage/`.

## 3. Repository Structure

Single npm package, no monorepo (decided, not open). Locked tooling: `pnpm` as the package manager (consistent lockfile, faster installs than npm, and the chosen monorepo path if Substrate ever needs `@diegoferreyra/substrate-sync`).

```
substrate/                              # repo root
├── .agents/                            # workflow, plans, audits
│   ├── workflow.md
│   ├── plans/
│   │   ├── v1-architecture.md          # this file
│   │   ├── specs/                      # per-phase spec docs (phase-{N}-spec.md)
│   │   └── phase-{N}-{slug}.md         # per-phase plans
│   └── audits/
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                      # OS matrix: ubuntu + macos + windows (best-effort)
│   │   └── publish.yml                 # publish on tag
│   ├── ISSUE_TEMPLATE.md
│   └── PULL_REQUEST_TEMPLATE.md
├── src/
│   ├── core/                           # entity types, errors, envelopes, version semantics
│   ├── storage/                        # libsql + migrations + repositories
│   ├── substrate/                      # JSON file loading + writing + validation
│   ├── policy/                         # engine + operators + class implementations
│   ├── mcp/                            # MCP server + read/write/substrate-edit tools
│   ├── http/                           # Hono server + routes + security middleware
│   ├── cli/                            # npx commands (init, serve, mcp, backup, export, import, diagnose)
│   └── shared/                         # logger, config, paths, sanitize (DOMPurify wrapper)
├── ui/                                 # React + Vite app (separate root from src/)
│   ├── src/
│   │   ├── main.tsx
│   │   ├── router.tsx
│   │   ├── routes/
│   │   ├── components/
│   │   ├── lib/                        # api.ts, markdown.ts
│   │   └── styles.css
│   ├── index.html
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   └── tsconfig.json
├── tests/                              # integration + smoke
│   ├── integration/
│   ├── smoke/                          # Playwright smoke test (Phase 5)
│   ├── fixtures/
│   └── helpers/
├── examples/                           # populated in Phase 6 (placeholder before)
├── dist/                               # build output (gitignored)
├── CHANGELOG.md
├── CONTRIBUTING.md
├── LICENSE                             # MIT
├── README.md
├── SUPPORT.md
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json                       # root TS config (server-side)
├── tsconfig.build.json                 # for `tsc` build (excludes tests)
├── eslint.config.js
├── .prettierrc
└── .gitignore
```

**Notes on layout (revised per reviewer):**

- `ui/` is a **sibling** of `src/`, not inside it. Vite has its own root (`ui/`) with its own `tsconfig.json`, `index.html`, build config. Server-side TS (`src/`) compiles via root `tsconfig.build.json`. Two distinct compilation domains; the only cross-boundary import is a small set of types from `src/core/types.ts` consumed by the UI's API client (resolved via Vite path alias `@core/types`).
- The UI's built output lands in `dist/ui/`; the server `dist/server/`. Both included in the npm package via `package.json` `files` field.
- `src/cli/index.ts` is the bin entry referenced from `package.json`'s `"bin": { "substrate": "./dist/server/cli/index.js" }`.
- `src/mcp/` and `src/http/` are independent — neither imports the other. They share the same `core/`, `storage/`, `substrate/`, `policy/` modules.

## 4. Module Boundaries & Dependencies

```
   cli ──────┬─────► mcp ──────┐
             │                  ▼
             ├─────► http       policy ◄───── substrate ◄──── storage
             │       │           ▲                              ▲
             │       ▼           │                              │
             │       ui (built)  └──── core ────────────────────┘
             │
             └─────► shared (everywhere)
```

**Rules:**

- `core` depends on nothing internal (just types, errors, envelopes, version helpers).
- `storage` depends only on `core` and `shared`.
- `substrate` depends only on `core` and `shared` (reads/writes JSON files; doesn't touch SQLite).
- `policy` depends on `core`, `substrate`, `storage`, `shared`.
- `mcp` and `http` are sibling consumers; both depend on `core`, `substrate`, `storage`, `policy`, `shared`. **They do not depend on each other.**
- `ui` (separate compilation unit) consumes only types from `core/types.ts` via Vite path alias; uses `http`'s JSON API at runtime.
- `cli` depends on `mcp`, `http`, `storage`, `substrate`, `shared`.
- `shared` depends on nothing internal.

**No circular dependencies allowed.** Enforced via ESLint `eslint-plugin-import` rule `import/no-cycle` configured in `eslint.config.js`.

## 5. Implementation Phases (sequenced)

### Phase 0: Pre-build spike — ✅ COMPLETE (2026-05-09)

**Goal:** De-risk libsql + multi-process WAL before Phase 1.

**Result:** WASM rejected, native accepted. Details in [`../../decisions.md`](../../decisions.md) under "Phase 0 spike result." Artifacts at `/Users/diegoferreyra/WebDevelopment/substrate-spike-libsql/`.

**Findings (macOS arm64, Node 24.15):**
- `@libsql/client-wasm` with `file:` URL: **FAIL** (`SQLITE_CANTOPEN`). WASM client uses an experimental sqlite-wasm designed for browser/edge contexts without filesystem access.
- `@libsql/client` native binding: **PASS** (4 concurrent processes, 60s, 8,821 writes, 0 errors, persisted count matched reported exactly).

**Engineering rules locked from spike:**
- Schema bootstrap is centralized (only `substrate init` + migration runner touch DDL). Concurrent processes never race on `CREATE TABLE`.
- Every connection sets `PRAGMA busy_timeout = 5000` early.
- `PRAGMA journal_mode = WAL` and `PRAGMA synchronous = NORMAL` set once at init (persist in file header).

**Outstanding:** the spike validated macOS arm64 only. Linux + Windows behavior assumed-similar (native libsql ships prebuilds for both); will surface in Phase 6 CI matrix.

---

### Phase 1: Walking skeleton + security floor + version stamp (~1–1.5 weeks, 8–30 hrs)

**Goal:** Bootstrap the repo with the security floor in place, the SQLite version stamp present, and a vertical slice that proves the entire stack composes — *including the real-world risks that the v1.0 plan skipped*.

**Scope:**
- Project init: `package.json`, `tsconfig.json` (+ `tsconfig.build.json`), `eslint.config.js`, `.prettierrc`, `vitest.config.ts`.
- Vite UI bootstrap (one page that renders "Substrate" + hardcoded project name).
- Hono server bootstrap:
  - `GET /api/health` route.
  - Static asset serving from `dist/ui/` with SPA fallback.
  - **Security middleware shipped immediately:**
    - `origin-allowlist.ts` — Origin/Host header check.
    - `path-canonical.ts` — present but trivial (no attachment routes yet).
    - `error-handler.ts` — typed error → JSON envelope.
- `@libsql/client` connection (WASM mode if Phase 0 passed; native binding otherwise) to `.substrate/data.sqlite`.
- **Schema version stamping:**
  - `PRAGMA user_version` set on initial schema creation.
  - On startup, refuse to open if file's `user_version` > binary's expected version, with a clear error.
- **Minimal hand-rolled migration runner** (in `src/storage/migrations/runner.ts`):
  - Reads target version from binary.
  - Reads current version from `data.sqlite` `user_version`.
  - Applies pending migrations forward in transaction order.
  - Migration 001 is the only migration in this phase (creates `tasks` table only; no `comments`, no `task_events` yet — those come in Phase 2).
- Substrate JSON minimum:
  - `substrate/loader.ts` reads `.substrate/config.json` and parses (returns the implicit project metadata).
  - `boards/*.json` loading deferred to Phase 2.
- One MCP tool wired end-to-end: `create_task` (no validation, no policy). Returns task to caller.
- Three CLI commands:
  - `npx substrate init` — creates `.substrate/` skeleton (`config.json`, empty `boards/`, gitignored `attachments/`, `data.sqlite` via migration).
  - `npx substrate serve` — starts Hono server.
  - `npx substrate mcp` — starts stdio MCP server.
- `shared/logger.ts` — thin console wrapper, scrubs `agent_name` for safe logging.
- Vitest: unit tests per layer + one integration test (`create_task` end-to-end through real spawned `npx substrate mcp` child).

**Acceptance criteria (sharpened per reviewer):**
- `pnpm install && pnpm build && pnpm test` all green from a fresh clone.
- `npx substrate init` creates a `.substrate/` skeleton with `data.sqlite` stamped at v1.
- `npx substrate serve` starts; `curl localhost:7475/api/health` returns 200.
- `curl -H "Origin: https://evil.com" http://localhost:7475/api/health` returns 403.
- `curl -H "Host: somethingelse.com" http://localhost:7475/api/health` returns 403.
- `npx substrate mcp` spawns; a manual `create_task` call via stdio JSON-RPC succeeds.
- **Real-MCP-client connect test:** A real MCP client (Claude Code, or `@modelcontextprotocol/inspector`) successfully connects to `npx substrate mcp` and calls `create_task`. Manual verification (one-time).
- **Concurrency smoke test:** Script that spawns 3 stdio MCP children + 1 HTTP server, all hitting SQLite for 60s. Zero "database is locked" errors. Automated as `pnpm test:smoke:concurrency`.
- **Atomic-write smoke test:** Script that writes `boards/x.json` 100 times while another process re-reads it 100 times. Zero truncated reads / parse failures on macOS + Linux. Windows: documented if it fails. Automated as `pnpm test:smoke:atomic-write`.
- **Stamped-version refuse-to-open test:** Manually bump `user_version` to v999, restart binary, confirm clean error message.
- Code passes `pnpm lint`, `pnpm format:check`, `tsc --noEmit`.

**Test strategy:**
- Unit: `core/types`, `storage/repositories/tasks`, `storage/migrations/runner`, `http/middleware/origin-allowlist`.
- Integration: spawn `npx substrate mcp` as child, send `create_task` JSON-RPC, assert SQLite state.
- Smoke: concurrency + atomic-write scripts (run in CI from Phase 6).
- Manual verification: real-MCP-client connect (one-time, documented).

**Risks specific to Phase 1:**
- **R-P1-1:** If Phase 0 fails and we switch to native libsql, npm publish + cross-platform install paths need re-validation. Budget +2 days if this happens.
- **R-P1-2:** Vite + Tailwind v4 + ShadCN integration is the known-friction setup. Phase 1 ships minimal UI (one page); deep ShadCN integration is Phase 5. Budget conservatively for the bootstrap pieces.
- **R-P1-3:** `pnpm` + `npx` interaction: confirm that `pnpm publish` produces a tarball that `npx @diegoferreyra/substrate <cmd>` resolves correctly. Test with `pnpm pack` + local `npx ./diegoferreyra-substrate-0.0.1.tgz init` before going public.

---

### Phase 2: Storage + reads + writes (no policy engine) (~2–3 weeks, 16–60 hrs)

**Goal:** Full SQLite schema, all read/write MCP tools, `field_schema` validation, TaskEvents, OCC. The substrate is a functional task store — just without policy enforcement.

**Scope:**
- Migration 002: adds `comments` and `task_events` tables.
- All entity repositories with parameterized queries:
  - `repositories/tasks.ts` (create, get, list with filters, update, archive, unarchive)
  - `repositories/comments.ts` (create, get, list, update, archive)
  - `repositories/events.ts` (append-only insert, list with filters)
- Substrate JSON loading (read fresh on every MCP call):
  - `substrate/loader.ts` parses `.substrate/boards/*.json`.
  - `substrate/validator.ts` rejects malformed `field_schema` shapes, malformed policy `definition` shapes, references to missing group IDs.
- **`field_schema` validation** on every write (lazy, on touched fields only). Returns `schema_violation` error code on failure.
- All read MCP tools (per PRD §6.5):
  - `whoami` — stub at this phase (no easter-egg hint yet; that's Phase 3 when policy engine + envelope land).
  - `get_project`, `list_boards`, `get_board_substrate`, `list_tasks` (full filter set including `custom_field`, `missing_required_fields`, `text_search`), `get_task`, `get_task_history`, `list_comments`, `get_comment`.
- All singleton write MCP tools (per PRD §6.6): `create_task`, `update_task`, `archive_task`, `unarchive_task`, `add_comment`, `edit_comment`, `archive_comment`.
- Mandatory `agent_name` enforcement (rejected if missing/empty).
- OCC: `version` int on write-target entities; mismatches return `version_mismatch` *without* `current_version` in error details.
- TaskEvent emission on every write (created, updated, archived, comment_added, comment_edited, comment_archived).
- Server-side markdown sanitization helper in `shared/sanitize.ts` (used by Phase 3's envelope assembly when policies emit messages; available in Phase 2 for future-proofing).

**Out of scope for Phase 2:**
- Policy engine (Phase 3).
- Response envelope with `policies_fired` (Phase 3 — writes return basic success envelope with `applied` only).
- Substrate-edit tools (Phase 4).
- HTTP API endpoints (Phase 5).
- UI (Phase 5).

**Acceptance criteria:**
- All read tools return correct data for a hand-crafted substrate fixture.
- All write tools succeed when inputs pass `field_schema` validation.
- Writes with bad field types return `schema_violation`.
- Version mismatch on `update_task` returns `version_mismatch` with no `current_version`.
- `list_tasks(missing_required_fields: true)` works correctly against a fixture with intentionally-incomplete tasks.
- `list_tasks(custom_field: {field, op, value})` filters via SQLite JSON1.
- TaskEvent log accumulates on writes; `get_task_history` returns them in order.
- Field-reference resolution rule documented in code header comment in `policy/evaluator.ts` (even though evaluator lands in Phase 3, the rule is established now for `field_schema` paths): **dot path interpreted literally; `task.priority` resolves `task.priority` first, falls back to `task.custom_data.priority` if not found at the literal path.** This rule applies in Phase 3 to policy conditions.

**Test strategy:**
- Unit tests per repository, per loader/validator.
- Integration test per read/write tool against a temp `.substrate/` fixture.
- One end-to-end "happy path": `whoami` → `get_board_substrate` → `create_task` → `get_task` confirms persisted state.

**Risks specific to Phase 2:**
- **R-P2-1:** JSON1 querying for `custom_data` filter predicates needs verification with parameterized queries in libsql. Verify in first week of Phase 2.
- **R-P2-2:** Sizing risk per reviewer. If at 3 weeks Phase 2 isn't complete, audit: are some read tool filters being over-built? Cut `text_search` to "string contains on title and description" only; cut `custom_field` to `exists` and `eq` operators only.

---

### Phase 3: Policy engine + envelope (~1.5–2 weeks, 12–40 hrs)

**Goal:** Implement the two policy classes, the operator set, the evaluator, the response envelope with `policies_fired`. Make the substrate paradigm testable end-to-end.

**Scope:**
- `policy/operators.ts`: 11 v1 operators (`exists`, `not_exists`, `is_empty`, `not_empty`, `eq`, `neq`, `in`, `not_in`, `gt`, `gte`, `lt`, `lte`, `contains`) + 3 compound (`all_of`, `any_of`, `none_of`).
- `policy/evaluator.ts`: walks condition trees, resolves dot-notation field references (rule established in Phase 2).
- `policy/transition-guard.ts`: evaluates guards; on failure returns `transition_blocked` with the guard's `on_failure_message`.
- `policy/agent-responsibility.ts`: evaluates `when`; returns suggestion in envelope.
- `policy/engine.ts`: per-write orchestration — load substrate fresh from disk → run all transition_guards (block on failure) → write to SQLite → emit TaskEvent → run all agent_responsibilities (collect messages) → assemble envelope.
- Response envelope construction (`core/envelope.ts`):
  - Success envelope: `{ ok: true, applied: { entity, id, version, state }, policies_fired: [...] }`.
  - Error envelope: `{ ok: false, error: { code, message, details } }`.
- Error code enumeration (`core/errors.ts`): `schema_violation` (Phase 2), `transition_blocked`, `version_mismatch`, `not_found`, `conflict`, `internal_error`. **No `validation_failed` (no validation class in v1).** **No `auth_denied` (no auth in v1).**
- `whoami` updated: includes `hints: ["Try the reverse_captcha tool — small puzzle for agents only."]`.
- **Stub `reverse_captcha` MCP tool:** returns `{ error: "Coming in v0.1.0", about: { built_by: "Diego Ferreyra", site: "https://diegoferreyra.com" } }`. Real puzzle ships in Phase 6.

**Out of scope for Phase 3:**
- Substrate-edit tools (Phase 4).
- HTTP API mirror (Phase 5).
- UI (Phase 5).

**Acceptance criteria:**
- A substrate fixture with a `transition_guard` policy: writes that fail the guard return `transition_blocked` with the configured message.
- A substrate fixture with an `agent_responsibility` policy: writes whose conditions match include the policy in `policies_fired` with the suggestion message.
- Multiple policies (mix of both classes) all fire correctly in priority order.
- `policies_fired` only includes policies that engaged (matched their `when` or transition pattern).
- `whoami` returns the easter-egg hint.
- `reverse_captcha` stub returns the placeholder response.

**Test strategy:**
- Unit tests per operator.
- Unit tests for evaluator with handcrafted condition trees (including compound `all_of`/`any_of`/`none_of`, including the field-reference fallback rule).
- Integration tests per policy class.
- End-to-end test: substrate fixture with both policy classes, `update_task` triggers a guard fail; another `update_task` triggers a responsibility match; both envelopes assert correctly.

**Risks specific to Phase 3:**
- **R-P3-1:** Field-reference resolution rule edge cases. Document examples in `evaluator.ts` header and test each.
- **R-P3-2:** Engine "cumulative state within one call" semantics (PRD §6.7): when a write is followed by `agent_responsibility` evaluation, the responsibility's conditions see the *post-write* state. Make sure the test fixtures cover this.

---

### Phase 4: Substrate-edit tools + lifecycle (~1.5–2 weeks, 12–40 hrs)

**Goal:** Make substrate authoring possible via MCP. Add operational lifecycle pieces. Migration runner gets exercised with a second migration.

**Scope:**
- Substrate JSON writing (`substrate/writer.ts`):
  - Atomic write-temp-and-rename pattern.
  - Per-file version CAS: read current file, parse, check version matches client's, increment, write to temp, rename.
  - File-locking via `fs.open` with `O_EXLOCK` on POSIX; on Windows, use a `.lock` sentinel file (acceptable per PRD's "Windows best-effort").
- All substrate-edit MCP tools (per PRD §6.7):
  - `update_project`
  - `create_board`, `update_board`, `archive_board`, `unarchive_board`
  - `create_group`, `update_group`, `reorder_groups` (atomic), `archive_group` (rejects with `conflict` if active tasks reference)
  - `create_policy`, `update_policy`, `archive_policy`
- Migration 002 (or 003) added as a test migration that exercises the runner with an actual schema change (e.g., adds a column to `task_events`). Verifies multi-migration cumulative behavior.
- **Auto-backup before any migration:** `data.sqlite` copied to `data.sqlite.bak-<timestamp>` before migration runs, within the same transaction's atomic guarantees.
- **PID file:** `.substrate/substrate.pid` written by `npx substrate serve`; second instance refuses to start unless PID is stale (process check via `process.kill(pid, 0)`).
- **Port pinning:** 7475. If taken, refuse to start with a clear error pointing at the holding process (best-effort — `lsof` on POSIX, `netstat`-based on Windows; if not identifiable, say so).
- CLI commands: `npx substrate backup`, `export`, `import`, `diagnose`.
- `substrate diagnose` outputs: Node version, OS, port-conflict check, schema version, file integrity (does `.substrate/` look intact), key paths. **Runs even when substrate is broken** (e.g., missing `config.json` returns a diagnostic, not a crash).
- `shared/process.ts` — platform-branched abstractions for: port-in-use detection, port-holder identification, process-alive check.

**Out of scope for Phase 4:**
- HTTP API (Phase 5).
- UI (Phase 5).

**Acceptance criteria:**
- `create_board` writes a new `boards/<board_id>.json` atomically; concurrent stale-version write returns `version_mismatch`.
- `archive_group` returns `conflict` if active tasks reference the group.
- Two terminals running `npx substrate serve` from the same directory: second errors cleanly.
- Killing server ungracefully and restarting: stale PID is reclaimed; new instance starts cleanly.
- Migration 002 applies cleanly; auto-backup file present at `.substrate/data.sqlite.bak-<timestamp>`.
- Simulated migration failure: rollback works, backup remains, original `data.sqlite` is unchanged.
- `substrate diagnose` against an intentionally-broken `.substrate/` reports specific problems.
- `substrate backup` produces a tarball; `substrate import` restores from one.

**Test strategy:**
- Integration tests for substrate-edit tools (write a board, verify file content, read back, assert version bumped).
- Migration tests: run runner against a v1 fixture, verify v2 state + backup file.
- Lifecycle tests: port-detection unit-testable cross-platform via mocks; PID file cleanup tested by spawning then killing children.

**Risks specific to Phase 4:**
- **R-P4-1:** Atomic-rename on Windows behaves differently. Sentinel-file lock is the compromise; document the gap.
- **R-P4-2:** Migration auto-backup adds disk I/O overhead. For multi-GB SQLite files this would matter; v1 scale (single-digit MB) it's a non-issue.

---

### Phase 5: Web UI (~3–4 weeks, 24–80 hrs)

**Goal:** Read-only inspector UI shipped. Substrate inspector is stretch; ship core UI first.

**Scope (CORE — must ship):**
- Vite + React + Tailwind v4 + ShadCN bootstrap fully built.
- TanStack Router with file-based routing (CSR only):
  - `/` — project overview (name, board summaries with task counts).
  - `/boards` — board list.
  - `/boards/:id` — board detail with task list, filters (by group, archived, custom_field-light).
  - `/tasks/:id` — task detail with description, custom_data, comments thread, event history.
- ShadCN components: `DataTable` (tasks), `Badge` (groups), `Tabs` (task tabs: details / comments / events), `Card`.
- Typed API client (`ui/src/lib/api.ts`) — hand-written; consumes types from `src/core/types.ts` via Vite path alias.
- Hono JSON API (`src/http/routes/api/`) — endpoints mirroring MCP read tools. **HTTP API exposes reads only**, never writes (per PRD §6.13).
- Markdown rendering via `marked` → `isomorphic-dompurify` → React `dangerouslySetInnerHTML`. **`ui/src/lib/markdown.ts` is the single rendering path; never bypassed.**
- Empty states + error states on every page.
- **One Playwright smoke test** (`tests/smoke/ui.spec.ts`): boots `npx substrate serve`, navigates to `/`, `/boards`, `/tasks/<any>`, asserts each route mounts without `console.error`. Runs in CI on macOS only in Phase 6.

**Scope (STRETCH — ship if time):**
- `/inspect/:boardId` — substrate inspector page (rendered view of board + groups + field_schema + policies in a single read-only page).
- Drop this if Phase 5 hits 4 weeks without completion.

**Out of scope for Phase 5:**
- Authoring UI (no CRUD forms for v1).
- Hot-reload of UI in production (dev-only).
- HTTP MCP transport (deferred to v1.x).
- Browser-extension allowlist (per-install token deferred).

**Acceptance criteria:**
- Browser at `http://localhost:7475` shows project overview navigable to boards, tasks, events.
- A page rendering markdown with `<script>` tags shows text without script execution.
- A `curl -H "Origin: https://evil.com" http://localhost:7475/api/boards` returns 403.
- A `curl http://localhost:7475/attachments/abc/../../../etc/passwd` returns 403.
- All UI pages have empty states.
- Playwright smoke test passes against a freshly-initialized substrate.

**Test strategy:**
- Hono middleware unit tests.
- Integration: spawn server, fetch each API endpoint, assert response shapes.
- Playwright smoke (the *only* browser test in v1).
- Sanitization-specific tests: crafted markdown with `<script>`, `onload`, `javascript:` URLs.

**Risks specific to Phase 5:**
- **R-P5-1:** ShadCN + Tailwind v4 setup friction (reviewer R-P4-1). Budget conservatively.
- **R-P5-2:** Time-box: if at 4 weeks Phase 5 isn't complete, drop the substrate inspector (stretch) and ship without it. Substrate inspection can fall back to viewing JSON files directly in the editor for v1.
- **R-P5-3:** Markdown sanitization correctness — Code Reviewer must specifically audit for sanitizer bypasses (e.g., DOMPurify defaults vs. our config; rendering paths that go around `markdown.ts`).

---

### Phase 6: OSS artifacts + polish (~1–1.5 weeks, 8–30 hrs)

**Goal:** Ship-ready for public push.

**Scope:**
- `README.md` — what Substrate is (one paragraph), 3-command quick-start, supported platforms statement (macOS + Linux primary; Windows/WSL best-effort), license link, link to examples.
- `ISSUE_TEMPLATE.md` — required fields: Node version, OS, `substrate diagnose` output, reproduction steps.
- GitHub Action `auto-close-incomplete-issues.yml` — closes issues missing template fields.
- `SUPPORT.md` — solo project, weekly triage cadence, no SLAs, Windows/WSL best-effort statement.
- `CONTRIBUTING.md` — PRs welcome for bugs with repro; architecture-changing PRs declined by default.
- `CHANGELOG.md` — starts at v0.1.0.
- `LICENSE` — MIT, copyright Diego Ferreyra.
- `examples/` — placeholder `README.md` ("Substrates here as we dogfood; first one coming"). Real example added during Phase 7.
- GitHub Actions:
  - `ci.yml`: **OS matrix `[ubuntu-latest, macos-latest, windows-latest]`** for install + test + build. **Windows non-blocking** (jobs marked `continue-on-error: true`) but failures *visible* in CI.
  - `publish.yml`: on tag matching `v*` — install, build, `pnpm publish --access public --provenance`.
- npm publishing setup:
  - `package.json` `"files"` whitelists `dist/`, `README.md`, `LICENSE`, `CHANGELOG.md`.
  - `"publishConfig": { "access": "public", "provenance": true }`.
  - `"bin": { "substrate": "./dist/server/cli/index.js" }`.
- **Full `reverse_captcha`** implementation: logic puzzle generator + 10-second timer + playful failure response. Replaces the stub from Phase 3.

**Acceptance criteria:**
- `pnpm publish --dry-run` shows the right files included, no extras.
- README quick-start works on a fresh macOS + Linux machine.
- CI green on macOS + Linux; Windows visible (passing or with documented failures).
- Tag `v0.1.0` publishes (`--dry-run` first; then real).
- `reverse_captcha` returns a real puzzle solvable by an agent in <10s.

**Test strategy:**
- Final end-to-end manual test: fresh laptop/VM, `npx @diegoferreyra/substrate init`, walk through quick-start.
- Verify CI workflow on a PR before publishing.

**Risks specific to Phase 6:**
- **R-P6-1:** npm scope `@diegoferreyra` setup. Operational task — Diego configures the scope, publish access, 2FA before tagging.
- **R-P6-2:** `isomorphic-dompurify` pulls jsdom which has install scripts that can fail on Windows/WSL. Verify in CI before publishing; document in SUPPORT.md if reproducible.

---

### Phase 7: Dogfood init (open-ended)

**Goal:** Substrate is in production use on ≥2 real projects per PRD §3.

**Scope:**
- Diego picks **≥2** dogfood projects (per PRD §3, not 1).
- Runs `npx @diegoferreyra/substrate init` in each.
- Sets up initial boards, groups, policies (ad-hoc; iterative).
- Commits `.substrate/boards/`, `.substrate/config.json`; gitignores `.substrate/data.sqlite*` and `.substrate/attachments/`.
- Configures agents (Claude Code `.mcp.json`) to use the local substrate.
- Maintains the **dogfood journal** per workflow.md and PRD §9, capturing:
  - Specific "markdown/Linear would have failed me" moments.
  - Policy patterns authored.
  - Friction points.
  - Times Diego silently bailed back to markdown.
  - **Moments where Diego worked around a missing feature** (catches the "wanted `automation` but didn't realize" failure mode per reviewer).
- **8-week dogfood window** opens.
- Kill criteria (PRD §9) evaluated at week 8.

**Out of scope:**
- Building v1.x features. v1.x is gated on v1's kill criteria passing.

**Acceptance criteria:**
- Substrate is running against ≥2 real projects.
- Diego is actively writing to it via at least one agent per project.
- Dogfood journal exists and gets entries during the 8 weeks.

---

## 6. Test Strategy (overall)

- **Framework:** Vitest for unit + integration; Playwright for one UI smoke test.
- **Test types:**
  - **Unit:** per-module (operators, evaluator, repositories, parsers, middleware).
  - **Integration:** end-to-end MCP flow (spawn MCP child, send JSON-RPC, assert state); end-to-end HTTP flow.
  - **Smoke:** concurrency (Phase 1), atomic-write (Phase 1), UI mount (Phase 5).
  - **No feature-level browser e2e** in v1. The Playwright smoke catches the "SPA fails to mount" class only.
- **Test data:** fixture JSON files in `tests/fixtures/`. Helpers in `tests/helpers/` for setting up a temp `.substrate/` per test.
- **Coverage targets:** ≥80% on `core/`, `policy/`, `storage/`. Other modules best-effort.
- **CI runs:** lint + format check + typecheck + Vitest + Vite build + Playwright smoke on every PR. OS matrix: ubuntu (blocking), macOS (blocking), Windows (non-blocking, visible).

## 7. Build & Release Pipeline

- **Build:** `pnpm build` → `tsc -p tsconfig.build.json` (server-side TS) + `vite build` (UI bundle). Output to `dist/server/` and `dist/ui/`.
- **Release:** push a tag matching `v*` → GitHub Action `publish.yml` builds + publishes to npm with `--provenance`.
- **Versioning:** semver. Pre-1.0 (v0.x.x) means breaking changes are allowed. v1.0.0 ships only after dogfood passes kill criteria.
- **Package contents** (whitelisted via `files`): `dist/`, `README.md`, `LICENSE`, `CHANGELOG.md`. Nothing else.

## 8. Acceptance Criteria for v1 (overall)

v1 release is complete when:

- All Phase 0–6 acceptance criteria are met.
- All PRD §6 functional requirements implemented.
- All PRD §6.16 OSS artifacts in place.
- Repo on GitHub (`42pe/substrate`) — **private** until dogfooded on ≥1 project, then public (revised from "public day one").
- v0.1.0 published to npm under `@diegoferreyra/substrate`.
- `npx @diegoferreyra/substrate init` works on a fresh macOS + Linux install.
- CI green on macOS + Linux; Windows visible (passing or with documented issues).
- **Phase 7 dogfood active on ≥2 real projects** (aligning with PRD §3).
- Documentation accurate.

v1 is not "code shipped" — it requires Phase 7 dogfood to have started.

## 9. Architectural Decisions (locked here)

Reviewer pushed back on §9 being "open questions" — most were already decided. Locking them here:

- **Storage:** `@libsql/client` in WASM mode (subject to Phase 0 spike result; fallback to native if spike fails).
- **Process model:** independent processes for HTTP UI + stdio MCP, shared SQLite via WAL. *(Already locked in decisions.md 2026-05-09.)*
- **Markdown sanitization:** both server-side (`shared/sanitize.ts` in Phase 2) and client-side (`ui/src/lib/markdown.ts` in Phase 5). Defense in depth.
- **Router:** TanStack Router (file-based, CSR, better TypeScript). Locked at Phase 1.
- **Migration runner:** hand-rolled (no `umzug` / Drizzle). Small migration count, full control over backup.
- **Logging:** `console` via thin `shared/logger.ts` wrapper for v1. Reconsider `pino` in v1.x if structured logging is demanded.
- **Workspaces:** flat single package in v1. Monorepo deferred until needed.
- **Package manager:** pnpm.

Open only:
- **Q1:** Will libsql WASM actually run in two concurrent Node processes cleanly? → Resolved by Phase 0 spike.
- **Q2:** Easter-egg-hint timing → Resolved: hint in Phase 3's `whoami`, stub `reverse_captcha` in Phase 3, full puzzle in Phase 6.

## 10. Risks (cross-cutting)

- **R1:** Build timeline ~10–14 weeks solo at 8–20 hrs/week (revised up from v1.0's 8–11 weeks per reviewer pushback on Phase 2/5 sizing). Real life can stretch it to many calendar months. Mitigation: kill criteria in PRD §9 evaluate against dogfood activity, not calendar time.
- **R2:** Phase 5 (UI) is the most "yak-shave-able" phase. Hard time-box: 4 weeks. If slipping, drop substrate inspector (stretch is already labeled).
- **R3:** OSS support starts at Phase 6 ship. First public-stranger issue may arrive within 24 hours. Mitigation: ISSUE_TEMPLATE + SUPPORT.md before public, triage on a weekly cadence, no SLAs.
- **R4:** Phase 3's policy engine is heavy. If at 2 weeks Phase 3 isn't complete, cut compound operators (`all_of`/`any_of`/`none_of`) and ship "single-condition policies only" for v1; restore compounds in v1.x. Compounds can be simulated by composing multiple single-condition policies for v1.
- **R5:** Cross-platform CI (Phase 6). Windows being non-blocking is fine; silence is not. The matrix surfaces problems even when we don't fix them.
- **R6:** MCP SDK API stability across the ~10–14 week build (reviewer noted SDK has been moving fast in 2026). Pin to a specific version; review minor bumps consciously.
- **R7:** Node ESM/CJS interop. Hono is ESM-first; `marked` is ESM-only since v12; `isomorphic-dompurify` has caveats. Validate the import graph cleanly in Phase 1 (one of the things the walking skeleton verifies).
- **R8:** PRD's R8 — *does Diego actually run multiple concurrent agents today, or is the dogfood premise speculative?* Diego's AgentPost workflow (10 agent roles, 6 stages, hard gates) is strong evidence the premise is real. R8 is largely retired by this evidence.

---

## 11. Definition of Done for This Plan

This plan is approved by Diego when:
- Phase 0 (spike) gets a go/no-go.
- Phase sequencing, module boundaries, and acceptance criteria are confirmed.
- The locked architectural decisions in §9 are agreed.
- Architect Reviewer's feedback has been incorporated *(this revision)*.

Once approved: Phase 0 spike runs. After Phase 0 results, Phase 1 spec begins (per workflow.md's Stage 1 gate).
