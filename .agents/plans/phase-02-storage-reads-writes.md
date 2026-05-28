# Phase 2 Plan — Storage + Reads + Writes

**Status:** Revised v1.1 (post Architect Reviewer pass — ready for development)
**Author:** Architect (revised after review)
**Last updated:** 2026-05-28
**Spec:** [`specs/phase-02-spec.md`](specs/phase-02-spec.md) (approved 2026-05-28)
**Architecture plan:** [`v1-architecture.md`](v1-architecture.md)
**Workflow:** [`../workflow.md`](../workflow.md)
**Feature branch:** `feature/phase-02-storage-reads-writes`
**Review notes:** Reviewer found CONCERN with 1 BLOCKER. Incorporated: split write step, locked tx ownership, added read-tools review gate, mandated bound JSON paths, fixed loadSubstrate wiring, deferred sanitizer to Phase 3.

---

## 1. Overview

The *what* is in the spec. This plan is the *how*: implementation order, file-by-file work, dependencies, test mapping, Code Reviewer checkpoints, merge strategy.

Phase 2 builds the full storage layer + all 16 singleton MCP tools (9 reads + 7 writes) + the substrate JSON loader + field_schema validation, on Phase 1's walking skeleton. **10 Steps.** **ONE Code Reviewer pass for the whole phase** (Step 8), after all development is complete and before the acceptance pass — per the workflow's per-phase review cadence (decided 2026-05-28; per-step review was amplifying scope). Development commits land per step on the feature branch and are reviewed as a batch before merge.

## 2. Branching & merge strategy

- Create `feature/phase-02-storage-reads-writes` from `main` (tag `phase-01-complete`).
- Commit per Step. **One Code Reviewer pass (Step 8)** covers the whole phase diff before merge (workflow §Code Review — per-phase cadence). The plan calls out per-Step "Reviewer focus" notes so the single Step-8 review knows where the risk is concentrated.
- Fast-forward merge to `main`, no squash, tag `phase-02-complete`.

**Dev-DB footgun (Reviewer #6):** Step 1 bumps `BINARY_SCHEMA_VERSION` to 2 with migration 002. Phase 1's guard refuses to open a `data.sqlite` whose `user_version` > the binary's. While this branch is in progress, any manually-inited dev `.substrate/data.sqlite` migrates to v2 and a `main`-built binary will refuse it (forward migrations are one-way; no down-migration in v1). **Mitigation: use a throwaway `.substrate/` for branch dev, or `rm .substrate/data.sqlite*` when switching back to main.** Tests are unaffected (they use temp DBs). Documented so it's not a surprise.

## 3. Dependencies

No new runtime deps in Phase 2:
- `@libsql/client` 0.17.3 (JSON1 for `custom_field` filters — verify in Step 2)
- `@modelcontextprotocol/sdk` 1.29.0
- `hono` 4.12.23 (unchanged — no new HTTP routes)
- `zod` 4.4.3 (all new tool shapes)

**Markdown sanitizer deferred to Phase 3** (Reviewer #3 on §3): the spec §3.7 had it ship in Phase 2 "for forward-compat," but nothing in Phase 2 consumes it and `isomorphic-dompurify` pulls `jsdom` (native-adjacent install risk per Phase 1 R5). Its first real consumer is Phase 3's `agent_responsibility` message rendering. Adding the dep when there's a consumer is strictly better. **This is a deliberate plan-level deviation from the approved spec §3.7; minor, no re-approval needed — flagged here for the record.**

## 4. Implementation order

### Step 1 — Schema, types, pagination, transaction primitive (Backend Engineer)

Foundation. No MCP surface.

Create / modify:
- `src/storage/migrations/002-comments-events.ts` — migration 002 per spec §3.1. Append to `migrations` list in `runner.ts`.
- `src/core/types.ts` — add `Comment`, `TaskEventType`, `TaskEvent`, `FieldSchemaEntry`, `FieldSchema`, `Group`, `Policy`, `Board`, `Substrate` per spec §3.2. Replace Phase 1 stubs.
- `src/core/envelope.ts` — **widen `SuccessEnvelope.applied.version` from `number` to `number | null`** (spec §3.6; comments have no OCC). Keep `successEnvelope` helper; update its signature.
- `src/core/pagination.ts` (new) — `paginationShape` (Zod) + `PaginationOutput` + `encodeCursor`/`decodeCursor`. **Cursor is generic over its tiebreaker type** (tasks: `id` string; events: `id` number) per Reviewer #5.
- `src/storage/client.ts` — add `withTransaction<T>(client, fn)` per spec §3.3. Re-applies busy_timeout in `finally`; Error.cause on rollback failure (mirror runner's pattern). Step 1 tests assert busy_timeout reapply after BOTH commit and rollback explicitly.
- `src/storage/repositories/tasks.ts` — refactor `createTask`/`getTask` to accept `Executor = Client | Transaction` (Reviewer answer to Open Issue 1: do the refactor here, not folded into write step).

Tests:
- `src/storage/migrations/002-comments-events.test.ts` — applies fresh; on top of 001; stamps user_version=2; rollback on simulated failure.
- `src/storage/client.test.ts` — extend: `withTransaction` commit reapplies busy_timeout; rollback reapplies; Error.cause on rollback-failure; result returned.
- `src/core/pagination.test.ts` — cursor round-trip (string + number tiebreaker); malformed cursor; page_size default/clamp.
- `src/core/envelope.test.ts` — extend: `version: null` accepted for comment entity.

Commit: `feat(storage): migration 002, core types, envelope version nullable, pagination, withTransaction (Step 1)`.

### Step 2 — Repository layer (Backend Engineer)

**Transaction ownership LOCKED (Reviewer #3, the spec §3.5-vs-§3.6 contradiction):** the *handler* owns the transaction. Repository functions take `Executor` and **never open their own `withTransaction`**. A write handler opens one `withTransaction(client, async (tx) => { ... })` and threads `tx` into every repo call (SELECT-for-merge, UPDATE, appendEvent) so the whole operation is atomic and the OCC read-for-merge is in the same tx as the write. The spec §3.5 "`return withTransaction(client, ...)`" example is misleading — repos do NOT wrap.

Create / modify:
- `src/storage/repositories/tasks.ts` — add `updateTask(exec, id, expectedVersion, patch, now)`, `archiveTask`, `unarchiveTask` (idempotent — return current state with no change if already in target state), `listTasks(client, opts)`.
  - OCC: SELECT current → check not_found / archived-conflict / version → UPDATE ... `version = version + 1 WHERE id = ? AND version = ?` → if rowsAffected 0, `version_mismatch` (no current_version).
  - `missing_required_fields`: build `OR (json_extract(custom_data, ?) IS NULL)` per required key, **binding `'$.' + key` as an arg** — NEVER interpolate the key into SQL text (Reviewer #5; substrate JSON is user-authored, not trusted). Requires `filters.board_id`.
  - `custom_field`: `json_extract(custom_data, ?) <op> ?` with bound path.
  - `text_search`: `(title LIKE '%'||?||'%' COLLATE NOCASE OR description LIKE '%'||?||'%' COLLATE NOCASE)`.
- `src/storage/repositories/comments.ts` (new) — `createComment`, `getComment`, `listComments`, `editComment` (no version, sets edited_at), `archiveComment` (idempotent).
- `src/storage/repositories/events.ts` (new) — `appendEvent` (returns persisted event w/ rowid), `listEvents` (event_type + since/until, `ORDER BY occurred_at, id`, pagination).

Tests:
- `tasks.test.ts` extend — update OCC happy + version_mismatch + archived-conflict; archive/unarchive idempotency; every list filter; pagination round-trip; JSON1 custom_field ops; **`missing_required_fields` with a malicious field name** (e.g. `"a') IS NULL OR (1=1"`) asserting no injection.
- `comments.test.ts` (new) — CRUD; edit LWW + edited_at; archive idempotency.
- `events.test.ts` (new) — append-only; tied-timestamp ordering via id tiebreaker; event_type filter; pagination.

_Reviewer focus (for the Step 8 whole-phase review):_ handler-owns-tx discipline (repos never wrap); OCC correctness + no current_version leak; **bound JSON paths, no string interpolation**; idempotency edges; SQL parameterization throughout.

Commit: `feat(storage): task/comment/event repositories with OCC + filters (Step 2)`.

### Step 3 — Substrate JSON layer (Backend Engineer)

Create:
- `src/substrate/schemas.ts` — Zod for `boards/<id>.json`.
- `src/substrate/loader.ts` — `loadSubstrate(root): Promise<Substrate>`. Strict load; globs `boards/*.json`; calls validator.
- `src/substrate/validator.ts` — `validateSubstrate`: duplicate board/group IDs, malformed field_schema, dangling group refs in policies (archived-group refs allowed).
- `src/substrate/field-validator.ts` — `validateFieldSchema(ctx)`: type/enum on touched keys; skip undeclared; never enforce required.

Tests:
- `loader.test.ts` — happy multi-board; boards/ missing → empty; malformed file → internal_error; shape mismatch → internal_error w/ issues.
- `validator.test.ts` — each structural failure; archived-group refs allowed.
- `field-validator.test.ts` — type checks per FieldSchemaEntry.type; undeclared accepted; null deletion allowed; required NOT enforced.

_Reviewer focus:_ strict-load failure modes, error-message actionability (point at file + path), validator completeness, no path-traversal in boards glob.

Commit: `feat(substrate): loader, validator, field-validator (Step 3)`.

### Step 4 — Read tools + tool wrapper + deps wiring (Backend Engineer)

Create / modify:
- `src/mcp/wrapper.ts` — `wrapToolHandler(schema, handler)`: catches ZodError → `schema_violation` envelope (spec §3.6). **Wraps ALL tools** (Reviewer answer to Open Issue 2 — reads validate their ID params too; one error surface).
- `src/mcp/deps.ts` — add `loadSubstrate: () => Promise<Substrate>` to `ToolDeps`.
- `src/mcp/server.ts` — extend `startStdioServer`'s param type to carry `loadSubstrate` (Reviewer #4: `mcp.ts` calls `startStdioServer({client, config})`, NOT a ToolDeps it builds).
- `src/cli/commands/mcp.ts` — build `loadSubstrate: () => loadSubstrate(paths(root).root)` and pass to `startStdioServer`. **`serve.ts` is untouched** — it's the HTTP path, no MCP tools in Phase 2 (Reviewer #4).
- Read tools in `src/mcp/tools/read/`: `get-project.ts`, `list-boards.ts`, `get-board-substrate.ts`, `list-tasks.ts`, `get-task.ts`, `get-task-history.ts`, `list-comments.ts`, `get-comment.ts`. Expand `whoami.ts`: board summaries **from substrate only — no DB read, no task counts** (Reviewer answer to Open Issue 3); `phase: 'v0.0.2 (storage + reads + writes)'`; `hints: []`.
- `src/mcp/registry.ts` — register all read tools.

Tests:
- One `*.test.ts` per read tool: contract snapshot + happy + edges.
- `src/mcp/wrapper.test.ts` — ZodError → schema_violation envelope; valid passes through.

_Reviewer focus:_ wrapper error shape, whoami stays pure-substrate (no DB read), list_tasks filter handler correctness.

Commit: `feat(mcp): read tools, tool wrapper, loadSubstrate wiring (Step 4)`.

### Step 5 — Task write tools (Backend Engineer)

Task entity is load-bearing; lands first (Reviewer #1 + answer to Open Issue 6 — this is the planned 5/6 fault line, not a fallback).

Modify / create in `src/mcp/tools/write/`:
1. `create-task.ts` — expand: load substrate, validate board+group exist, field_schema validation, emit `created` event. Handler opens `withTransaction`.
2. `update-task.ts` (new) — handler owns tx: load task → derive `board_id` → find board in substrate (**if board missing from substrate → `not_found`**, Reviewer #8) → custom_data partial merge (null deletes) → field_schema validation on touched → OCC → UPDATE → emit `updated` event with before/after. `board_id`/`parent_id` not in shape (→ schema_violation via wrapper).
3. `archive-task.ts` / `unarchive-task.ts` (new) — idempotent; emit `archived`/`unarchived` only on actual state change.
- `src/mcp/registry.ts` — register task write tools.

Tests: one `*.test.ts` per tool — contract snapshot + happy + every §5 edge + TaskEvent emission verified by reading task_events. Include: update on archived task → conflict; update with board_id in input → schema_violation; update when task's board missing from substrate → not_found; custom_data null-delete.

_Reviewer focus:_ every write uses withTransaction; TaskEvent never outside the tx; OCC no current_version; custom_data merge (null deletes); idempotent archive emits no event; board-resolution-for-validation path.

Commit: `feat(mcp): task write tools — create/update/archive/unarchive with TaskEvents (Step 5)`.

### Step 6 — Comment write tools (Backend Engineer)

Modify / create in `src/mcp/tools/write/`:
1. `add-comment.ts` (new) — validate task exists + not archived; parent (if any) exists, same task, not archived; field_schema.comments validation; emit `comment_added`. Handler owns tx.
2. `edit-comment.ts` (new) — no version; set edited_at; emit `comment_edited` with **`before.body`** (audit for LWW data loss, spec Q2).
3. `archive-comment.ts` (new) — idempotent; emit `comment_archived`.
- `src/mcp/registry.ts` — register comment write tools.

Tests: one `*.test.ts` per tool — contract + happy + §5 edges (parent from different task → conflict; comment on archived task → conflict; edit LWW; idempotent archive) + TaskEvent emission incl. `before.body` on edit.

_Reviewer focus:_ parent validation (same task, not archived); comment_edited before.body present; comment envelope `version: null`; withTransaction discipline.

Commit: `feat(mcp): comment write tools — add/edit/archive with TaskEvents (Step 6)`.

### Step 7 — Integration + smoke tests (Backend Engineer)

(No sanitizer — deferred to Phase 3 per §3.)

- Rename `tests/integration/mcp-create-task.test.ts` → `mcp-bootstrap-flow.test.ts`; expand to the full §4 spec flow: author a fixture board file → whoami → get_board_substrate → create_task (valid + invalid severity) → update_task (+ stale version) → archive/unarchive → comment lifecycle → get_task_history → list_tasks filters.
- Update `tests/smoke/concurrency-worker.mjs`: each write also INSERTs a `created` task_event (mirror real write path); assert task_events count == reported writes.
- Expand `tests/manual/run-smoke.mjs`: bootstrap flow + new envelope shapes (version: number|null).

Commit: `test: full bootstrap-flow integration + concurrency/manual smoke updates (Step 7)`.

### Step 8 — 🛑 Code Reviewer pass (whole phase)

Per the per-phase cadence. Spawn ONE Code Reviewer over the full Phase 2 diff (`git diff main..HEAD`). It uses the per-Step "Reviewer focus" notes above to concentrate on the risky surfaces:
- Storage/OCC (Steps 1-2): handler-owns-tx, no current_version leak, bound JSON paths, idempotency.
- Substrate (Step 3): strict-load failure modes, no path traversal in glob.
- Reads (Step 4): wrapper error shape, whoami pure-substrate.
- Task writes (Step 5): withTransaction discipline, TaskEvent atomicity, custom_data merge.
- Comment writes (Step 6): parent validation, before.body audit, version:null envelope.

Fix BLOCKERs + CONCERNs in a follow-up `fix(review)` commit. Then proceed.

Commit: `fix(review): address Phase 2 Code Reviewer findings (Step 8)` (only if findings).

### Step 9 — Final acceptance pass (Backend Engineer)

- `pnpm build` clean (server + ui)
- `pnpm test` green (target: every §5 edge case has a test; count is a *floor* of ~250, realistically 300-380 — map to coverage, not the number, per Reviewer #7)
- `pnpm test:smoke:concurrency` green (task + event counts match)
- `pnpm exec tsc --noEmit` (root + ui) clean; `eslint` + `prettier` clean
- `node tests/manual/run-smoke.mjs` — full bootstrap flow passes
- `npm pack --dry-run` — package contents sane
- Bump `BINARY_VERSION` to `0.0.2` (schema version already bumped to 2 in Step 1)

Commit: `chore(phase-02): final acceptance pass (Step 9)`.

### Step 10 — Audit + merge

- Spawn Assistant agent → `.agents/audits/phase-02-audit.md`.
- Resolve gaps.
- Fast-forward merge to `main`, tag `phase-02-complete`.

## 5. Test mapping (spec §4 → plan)

| Spec test requirement | Plan location |
|---|---|
| Migration 002 unit | Step 1 |
| withTransaction unit | Step 1 (`client.test.ts`) |
| envelope version nullable | Step 1 (`envelope.test.ts`) |
| pagination cursor | Step 1 (`pagination.test.ts`) |
| tasks repo | Step 2 |
| comments repo | Step 2 |
| events repo | Step 2 |
| missing_required_fields injection | Step 2 (malicious field name test) |
| substrate loader/validator/field-validator | Step 3 |
| read tools (×9) + wrapper | Step 4 |
| task write tools (×4) | Step 5 |
| comment write tools (×3) | Step 6 |
| bootstrap-flow integration | Step 7 |
| concurrency smoke (task+event counts) | Step 7 |
| real-MCP-client smoke | Step 7 |

## 6. Risks

- **R1: `withTransaction` misuse / repo-owned tx.** Mitigation: tx-ownership locked (handler owns; repos take `Executor`, never wrap). Code Reviewer at Steps 2/5/6 verifies.
- **R2: JSON1 `custom_field`.** Verify libsql `json_extract` w/ bound args in week 1 of Step 2. Fallback: cut to `exists`+`eq`.
- **R3: `missing_required_fields` dynamic SQL injection.** Mitigation: bind `'$.'+key` as an arg to `json_extract(custom_data, ?)`; NEVER interpolate into SQL text. Step 2 test with malicious field name. Code Reviewer verifies.
- **R4: Phase 2 scope is large.** Task writes (Step 5) land before comment writes (Step 6) — clean fault line. If Step 6 slips, tasks are usable without comments.
- **R5: comment edit data loss.** Mitigated by `before.body` in `comment_edited` event; Code Reviewer at Step 6 verifies.
- **R6: dev-DB schema-bump footgun.** Documented in §2. Throwaway dev `.substrate/`.
- **R7: update_task board resolution.** Handler resolves board via `task.board_id` → substrate; missing board → `not_found`. Specified in Step 5.

## 7. Resolved (Architect Reviewer answers to Open Issues)

1. `createTask` `Executor` refactor → **Step 1** (don't fold into write step; refactor separate from new behavior).
2. `wrapToolHandler` → **wraps all tools** (reads too; one error surface).
3. `whoami` → **pure-substrate, no DB read** (no task counts).
4. `BINARY_SCHEMA_VERSION` bump → **Step 1** with the migration; dev-DB footgun documented (§2).
5. Cursor → **generic over tiebreaker type** (tasks string id, events number id); divergence acceptable.
6. tasks-first / comments-trail → **the planned Step 5/6 boundary**, not a fallback.

## 8. Definition of Done

Phase 2 complete when:
- All Step §4 commits on `feature/phase-02-storage-reads-writes`.
- The single whole-phase Code Reviewer pass (Step 8) is done and all BLOCKER/CONCERN findings resolved.
- All spec §8 acceptance criteria met.
- Assistant audit clean.
- Fast-forward merge to `main`, tag `phase-02-complete`.
