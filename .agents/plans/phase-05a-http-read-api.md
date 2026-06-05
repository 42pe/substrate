# Phase 5a Plan — HTTP JSON Read API

**Status:** Reviewed v1.1 (Architect Reviewer: approve-with-changes, no BLOCKERs) — ready for development
**Author:** Architect (revised after review)
**Last updated:** 2026-06-03
**Review notes:** Incorporated C3 (page_size over-max is a 400, not a clamp — the shared schema `.max(200)` rejects), C2 (honor the spec's `ApiDeps = Pick<ToolDeps,'client'|'config'|'loadSubstrate'>`; pass it to the handlers via `as ToolDeps` so the unused `root` is provably absent), C1 (the static route is `/` + `/assets/*`, NOT a `*` catch-all — no shadowing today; mount `/api` first defensively for 5b), C4 (`projectRoot` = cwd for UI assets vs `apiDeps.root`-less Pick are distinct), N1 (wrong-method → 404 in Hono), N2 (unknown-id on /history+/comments → empty 200), N4 (`parent_id` null-vs-absent query convention).
**Spec:** [`specs/phase-05a-spec.md`](specs/phase-05a-spec.md) (APPROVED 2026-06-03)
**Architecture plan:** [`v1-architecture.md`](v1-architecture.md) §5 Phase 5
**Workflow:** [`../workflow.md`](../workflow.md)
**Feature branch:** `feature/phase-05a-http-read-api`

---

## 1. Overview

Phase 5a ships the read-only HTTP JSON API the Phase 5b UI will consume: 8 `GET /api/...` endpoints mirroring the MCP read tools, mounted under the existing security middleware. It REUSES the MCP read handlers (single source of truth) so routes are thin query→input adapters. No writes, ever. No UI. **No schema change**; `BINARY_VERSION` → `0.0.5` at acceptance.

It's a small, browser-free phase: **3 steps, one Code Reviewer gate**.

## 2. Branching & merge strategy

- Create `feature/phase-05a-http-read-api` from `main` (tag `phase-04-complete`).
- Commit per step. One Code Reviewer pass (Step 2).
- Fast-forward merge to `main`, no squash, tag `phase-05a-complete`.
- No dev-DB footgun (no schema bump).

## 3. Dependencies

No new deps — Hono is already in use; the API reuses existing handlers, the pagination/Zod schemas, and the error-handler.

## 4. Implementation order

### Step 1 — API routes + wiring + tests (Backend Engineer)

Create / modify:
- `src/http/server.ts` — `HttpConfig` gains `apiDeps?: ApiDeps` where **`ApiDeps = Pick<ToolDeps, 'client' | 'config' | 'loadSubstrate'>`** (C2 — honor the spec; the read handlers don't use `root`, and omitting it structurally proves the HTTP surface can't reach the write root). Route adapters pass it to the handlers via `apiDeps as unknown as ToolDeps` (the handlers are typed on `ToolDeps`; the cast is sound because no read handler references `root` — verified). In `createApp`, mount the API **only when `config.apiDeps` is present**, AFTER the origin allowlist and BEFORE the static fallback. **C1: the static route registers only `/` + `/assets/*` (NOT a `*` catch-all), so there is no shadowing today — `/api` ordering is defensive for 5b's client-side-routing fallback.** `defaultHttpConfig` is unchanged (no apiDeps); `serve.ts` adds `apiDeps` to the config it builds.
- `src/http/routes/api/index.ts` — `registerApiRoutes(app, deps)` registers the 8 routes. Each handler: parse request → call the MCP read handler → `c.json(result)`. Thrown `SubstrateError`s propagate to the existing `app.onError(errorHandler)`.
- `src/http/routes/api/query.ts` — coercion helpers: `boolParam` (`'true'`→true, `'false'`→false, absent→undefined), `intParam`, `listParam` (comma-split), `strParam`. **N4: `parent_id` convention — `?parent_id=null` → `null` (thread-root), omitted → undefined (no filter); document in `query.ts`.** A value the underlying Zod rejects becomes `schema_violation` → 400.
- `src/cli/commands/serve.ts` — build `apiDeps = { client, config, loadSubstrate: () => loadSubstrate(root) }` and include it in `httpConfig`. **C4: `httpConfig.projectRoot` stays `cwd` (locates `dist/ui`); `apiDeps` carries no `root` — the two are deliberately distinct, don't unify them.**

Endpoints (spec §3.2), each reusing the named handler:
| Route | Handler |
|---|---|
| `GET /api/project` | `getProjectHandler(deps)` |
| `GET /api/boards` | `listBoardsHandler({ archived?, pagination? }, deps)` |
| `GET /api/boards/:id` | `getBoardSubstrateHandler({ board_id }, deps)` |
| `GET /api/tasks` | `listTasksToolHandler({ filters, sort?, pagination? }, deps)` |
| `GET /api/tasks/:id` | `getTaskToolHandler({ id }, deps)` |
| `GET /api/tasks/:id/history` | `getTaskHistoryHandler({ task_id, filters?, pagination? }, deps)` |
| `GET /api/tasks/:id/comments` | `listCommentsToolHandler({ task_id, filters?, pagination? }, deps)` |
| `GET /api/comments/:id` | `getCommentToolHandler({ id }, deps)` |

- `list_tasks` filters parsed from query: `board_id`, `in_groups` (comma), `not_in_groups`, `parent_id`, `archived` (bool), `text_search`, `missing_required_fields` (bool), `created_before/after`, `updated_before/after`; `sort`=`{field,direction}` from `?sort=&direction=`; `pagination`=`{cursor,page_size}`. **`custom_field` omitted** (spec §7.3). The handler already enforces `missing_required_fields` requires `board_id` → 400.
- Build the handler input objects respecting `exactOptionalPropertyTypes` (only include keys when present), same pattern as the MCP tools.

Tests:
- `src/http/routes/api/api.test.ts` — build an app via `createApp` with `apiDeps` over a real temp DB + an authored board fixture (seed via repos + `createBoardFile`). Use `app.request()` (no port bind). Cover: each endpoint happy path; unknown task/board id → 404 + error body; **unknown task_id on `/history` + `/comments` → 200 with empty results (NOT 404 — by design, N2)**; `missing_required_fields` without `board_id` → 400; **`page_size=9999` → 400 `schema_violation` (the schema rejects over-max, C3)**; `page_size=abc` → 400; cross-origin (`Origin: https://evil.com`) → 403; **`POST /api/boards` → 404 (Hono returns 404 for a wrong method, not 405, N1)**; pagination round-trip (cursor) on `/api/tasks`. Plus a route-ordering guard: `/api/project` returns JSON, not the SPA HTML (locks C1 before 5b).

_Reviewer focus (Step 2):_ reads-only (no write verb routable; confirm no `app.post/put/...` under `/api`); `/api` ordered before the static catch-all; origin allowlist gates `/api`; handler reuse (no duplicated query logic); error propagation → correct status; query coercion edges; `exactOptionalPropertyTypes` input construction.

Commit: `feat(http): read-only JSON API mirroring MCP reads (Step 1)`.

### Step 2 — 🛑 Code Reviewer pass (whole phase)

One Code Reviewer over `git diff main...HEAD`. Concentrate on:
- **Reads-only guarantee:** no write route exists; a write verb is unroutable; the API can't mutate state.
- **Security:** origin/Host allowlist covers `/api`; `/api` precedes the SPA fallback; no new path-traversal surface (no fs path params in the API).
- **Correctness:** handler reuse (single source of truth); thrown errors → correct HTTP status; query coercion (bool/int/list) + malformed-value → 400; pagination clamp.
- **No envelope leakage:** reads return raw shapes, not MCP envelopes.

Fix BLOCKERs + CONCERNs in a `fix(review)` commit.

Commit: `fix(review): address Phase 5a Code Reviewer findings (Step 2)` (only if findings).

### Step 3 — Acceptance + audit + merge (Backend Engineer → Assistant)

- Acceptance gate: `pnpm build`, `pnpm test`, `tsc` (root+ui), `eslint`, `prettier`, `pnpm test:smoke:concurrency`, `node tests/manual/run-smoke.mjs`, `npm pack --dry-run`. Bump `BINARY_VERSION` → `0.0.5`.
- Optionally extend `tests/integration/serve-lifecycle.test.ts` (or the manual smoke) with a live `GET /api/project` fetch against a spawned `serve` (proves the wiring end-to-end over a real bound port).
- Spawn Assistant → `.agents/audits/phase-05a-audit.md`. Resolve gaps.
- Fast-forward merge to `main`, tag `phase-05a-complete`.

Commits: `chore(phase-05a): acceptance pass + 0.0.5 (Step 3)`, `docs(phase-05a): assistant audit (Step 3)`.

## 5. Test mapping (spec §5 → plan)

| Spec requirement | Plan location |
|---|---|
| each endpoint shape | Step 1 (`api.test.ts`) |
| 404 / 400 / clamp edges | Step 1 |
| cross-origin 403 | Step 1 |
| write-verb unroutable | Step 1 |
| end-to-end over a bound port | Step 3 (serve-lifecycle / smoke) |

## 6. Risks

- **R1 (route ordering — defensive, not a live bug):** the static route currently registers only `/` + `/assets/*`, so it does NOT shadow `/api` today (C1). We still register `/api` before it so 5b's eventual client-side-routing `*` fallback can't shadow the API. A test asserts `/api/project` returns JSON, not SPA HTML.
- **R2 (accidental write surface):** none by construction — only `app.get` under `/api`. Reviewer verifies; a `POST /api/boards → 404` test guards it.
- **R3 (deps typing):** reusing handlers typed on `ToolDeps` means `apiDeps` carries an unused `root`. Acceptable (documented); reads never call it.
- **R4 (query coercion drift):** a malformed query value must become a clean 400, not a 500. Mitigation: coercion produces values the existing Zod schemas validate; malformed → `schema_violation`. Tested.

## 7. Definition of Done

- All step commits on `feature/phase-05a-http-read-api`.
- Single Code Reviewer pass done; BLOCKER/CONCERN findings resolved.
- Spec §6 acceptance criteria met.
- Assistant audit clean.
- Fast-forward merge to `main`, tag `phase-05a-complete`.
