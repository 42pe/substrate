# Phase 5a Spec — HTTP JSON Read API

**Status:** APPROVED (Diego, 2026-06-03) — §3.0 decisions locked; §7 recommendations all confirmed.
**Author:** Spec Team
**Last updated:** 2026-06-03
**Architecture plan:** [`../v1-architecture.md`](../v1-architecture.md) §5 Phase 5
**Predecessor:** Phase 4 (`phase-04-complete`) — full 29-tool MCP surface; HTTP server has security middleware + health + static, no API yet.

---

## 1. Goal

Phase 5 (the Web UI) is split into **5a (this spec — the read API)** and **5b (the React UI)** per the time-box risk (Diego, 2026-06-03). 5a ships the Hono JSON API the UI will consume: read-only endpoints mirroring the MCP read tools, mounted under the existing security middleware. It is fully testable without a browser, so it lands fast and is reviewable before the UI is built on it.

**Reads only.** The HTTP surface NEVER exposes writes (PRD §6.13) — no POST/PUT/PATCH/DELETE routes exist. Writes are MCP-only.

## 2. Scope

**In scope:**
- `src/http/routes/api/` — Hono read endpoints mirroring the 9 MCP read tools (§3.2).
- Wiring `apiDeps` into `createApp` so routes can reach the DB + substrate (§3.1).
- `serve.ts` passes `apiDeps` built from the opened client (§3.1).
- Integration tests: spawn the server, fetch each endpoint, assert shapes + status codes; cross-origin 403; reads-only (write verbs 404/405).

**Out of scope (5b or later):**
- Any UI / React / ShadCN / router / markdown rendering (Phase 5b).
- Server-side markdown sanitization (the UI sanitizes client-side — Phase 5b; the API returns raw markdown).
- Per-board task counts on the overview (small addition; deferred to 5b if the UI needs them).
- Substrate inspector endpoint (dropped from v1).
- HTTP write endpoints (never in v1).
- Auth / tokens / remote access (localhost-only, v1).

## 3. Design

### 3.0 Locked decisions (Diego, 2026-06-03)

1. **Phase 5 is split: 5a (read API) then 5b (React UI).**
2. **Substrate inspector dropped from v1.**
3. **Markdown sanitization is UI-only** (Phase 5b, browser DOMPurify) — the API returns raw markdown.

### 3.1 Wiring: `apiDeps` into the app

The read endpoints reuse the existing MCP **read handlers** (single source of truth — same logic as the tools, no duplicated query code). Those handlers take a `ToolDeps`-shaped object. So:

- `HttpConfig` gains an optional `apiDeps?: ApiDeps` where `ApiDeps = Pick<ToolDeps, 'client' | 'config' | 'loadSubstrate'>` (no `root` — reads don't write files).
- `createApp(config)` mounts `/api` routes **only when `config.apiDeps` is present**. Health-only tests (no DB) keep working unchanged.
- `serve.ts` builds `apiDeps` from the client it already opens (`{ client, config, loadSubstrate: () => loadSubstrate(root) }`) and passes it in `defaultHttpConfig`/the merged config.
- The MCP read handlers are imported and called directly; a thin route adapter maps query/params → the handler's input shape and returns `c.json(result)`. Thrown `SubstrateError`s propagate to the existing `app.onError(errorHandler)` which maps them to HTTP status via `httpStatusFor`.

### 3.2 Endpoints

All under `/api`, all `GET`, all behind the origin allowlist. JSON responses. `not_found` → 404, `schema_violation` (bad query) → 400, `internal_error` → 500 — via the existing error-handler.

| Method + path | Mirrors | Input from request | Response |
|---|---|---|---|
| `GET /api/project` | `get_project` | — | project record (id, name, description, version, schema_version, created_at) |
| `GET /api/boards` | `list_boards` | `?archived=true\|false`, `?cursor=`, `?page_size=` | `{ results: BoardSummary[], pagination }` |
| `GET /api/boards/:id` | `get_board_substrate` | path `:id` | `{ board, groups, field_schema, policies }` |
| `GET /api/tasks` | `list_tasks` | `?board_id=`, `?in_groups=a,b`, `?not_in_groups=a,b`, `?has_subtasks=`, `?archived=`, `?text_search=`, `?missing_required_fields=true`, `?parent_id=`, `?created_before/after=`, `?updated_before/after=`, `?cursor=`, `?page_size=`, `?sort=created_at\|updated_at`, `?direction=asc\|desc` | `{ results: Task[], pagination }` |
| `GET /api/tasks/:id` | `get_task` | path `:id` | `Task` |
| `GET /api/tasks/:id/history` | `get_task_history` | path `:id`, `?event_types=a,b`, `?since=`, `?until=`, `?cursor=`, `?page_size=` | `{ results: TaskEvent[], pagination }` |
| `GET /api/tasks/:id/comments` | `list_comments` | path `:id`, `?parent_id=`, `?since=`, `?until=`, `?cursor=`, `?page_size=` | `{ results: Comment[], pagination }` |
| `GET /api/comments/:id` | `get_comment` | path `:id` | `Comment` |

- **Query coercion** is centralized in a small `parseQuery` helper per route: booleans (`'true'`→true), ints (`page_size`), comma-lists (`in_groups`, `event_types`). A malformed value the underlying handler/Zod rejects surfaces as `schema_violation` → 400. `custom_field` is omitted from the HTTP surface in 5a (compound query object is awkward over query-string; the UI's board-detail filters use group/text_search/archived — `custom_field` can be added in 5b if needed).
- **`missing_required_fields`** requires `board_id` (same rule as the tool) → 400 without it.
- Unknown `/api/...` path → 404 (Hono default). A write verb on a read route → 404/405 (no handler registered for that method).

### 3.3 Security posture (already in place — confirm coverage)

- **Origin/Host allowlist** (`originAllowlist`, Phase 1) is `app.use('*')` — it gates `/api` too. A cross-origin `Origin: https://evil.com` → 403. Acceptance criterion verified by test.
- **Path-canonical** traversal guard applies to the attachments/static path, not `/api` (no fs path params in the API). No change.
- **Reads only:** no write route is ever registered, so the API cannot mutate state regardless of method.
- Localhost-only bind (127.0.0.1) unchanged.

### 3.4 Response conventions

- Success: the raw read shape (NOT the MCP envelope — reads return data directly, per PRD §6.5). `c.json(result)`.
- Error: the existing error-handler emits `{ error: { code, message, details? } }` with the mapped status. Consistent with the MCP error envelope's `error` object.
- No `Cache-Control` games in v1 (localhost, fresh reads).

## 4. Edge cases

| Case | Expected |
|---|---|
| `GET /api/tasks/:id` unknown id | 404, `{ error: { code: 'not_found', ... } }` |
| `GET /api/boards/:id` unknown board | 404 |
| `GET /api/tasks?missing_required_fields=true` (no board_id) | 400 `schema_violation` |
| `GET /api/boards?page_size=9999` | 400 `schema_violation` — `paginationShape` is `.max(200)`, which REJECTS (does not clamp) |
| `GET /api/boards?page_size=abc` | 400 `schema_violation` |
| cross-origin request (`Origin: https://evil.com`) | 403 (allowlist) |
| `POST /api/boards` | 404 (no write route) |
| malformed cursor | 400 `schema_violation` (decodeCursor throws it) |
| substrate file malformed on disk | 500 `internal_error` (loadSubstrate strict) |

## 5. Test strategy

- `routes/api/*.test.ts` or one `api.test.ts` — `app.request()` against an app built with a real temp DB + authored board fixture: each endpoint happy path + the §4 edges (404, 400, clamp, cross-origin 403, write-verb 404).
- Reuse the Phase 1 HTTP test harness (`createApp` + `app.request`).
- Confirm the MCP read handlers are the ones doing the work (no logic duplicated in routes).

## 6. Acceptance criteria

- Each endpoint in §3.2 returns the documented shape against a seeded substrate.
- `curl -H "Origin: https://evil.com" http://localhost:7475/api/boards` → 403 (test-equivalent via `app.request`).
- An unknown task/board id → 404 with an error body; a bad query → 400.
- No write verb is routable under `/api`.
- `pnpm test`, `tsc` (root+ui), `eslint`, `prettier`, `pnpm build`, concurrency smoke, manual MCP smoke all green.
- `BINARY_VERSION` → `0.0.5` (no schema change).

## 7. Recommended decisions — ALL CONFIRMED (Diego, 2026-06-03)

1. **API reuses the MCP read handlers** (no duplicated query logic; one source of truth). Recommend confirm.
2. **`apiDeps` optional on `HttpConfig`; `/api` mounted only when present** (health-only tests unaffected). Recommend confirm.
3. **`custom_field` filter omitted from the HTTP API in 5a** (awkward over query-string; UI filters use group/text/archived). Recommend confirm.
4. **API returns raw read shapes, not MCP envelopes** (per PRD §6.5). Recommend confirm.
5. **Per-board task counts deferred to 5b** (the UI overview decides if it needs them). Recommend confirm.

## 8. Definition of Done (for this spec)

Approved by Diego when §3.0 decisions stand and §7 recommendations are confirmed. Then per workflow.md Stage 2: Architect drafts the 5a plan → Architect Reviewer → revision → Diego approves → development.
