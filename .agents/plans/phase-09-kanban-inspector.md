# Phase 9 Plan — Kanban inspector (board view as columns + live polling)

**Status:** Reviewed v1.1 (Architect Reviewer APPROVE-WITH-CHANGES; C1–C2 + N1/N3/N5 incorporated) — ready for development.
**Author:** Architect
**Last updated:** 2026-06-06
**Spec:** [`specs/phase-09-kanban-inspector-spec.md`](specs/phase-09-kanban-inspector-spec.md) (APPROVED — B1–B3 + C1–C8 folded in)
**Architecture plan:** [`v1-architecture.md`](v1-architecture.md)
**Predecessor:** Phase 5b (read-only React inspector). Shipped binary `0.2.1`. Phases 7b (error logging) and 8 (shareable templates) are specced-but-unbuilt and both currently target `0.3.0` — so this phase's version number is assigned at acceptance (Step 6), NOT hard-coded.
**Feature branch:** `feature/phase-09-kanban-inspector` (from `main`).

---

## 1. Overview

Turn the board view from a flat task table into a **kanban** (columns = active groups, ordered by `Group.position`), add a stacked **multi-board kanban wall** to the Overview, and make the inspector **reflect agent task-moves live** via visibility-aware polling. Adds **one** HTTP read endpoint (`GET /api/boards/:id/columns?limit=K`) backed by a storage/reads aggregate — the project's **first** count/aggregate query and its **first** `/api` route with no MCP twin (precedent: `/api/health`).

**Read-only by contract — no drag-and-drop, no writes.** "Updates as tasks move" = polling observing the agents' MCP moves, not user dragging. There is no optimistic update and nothing to roll back.

**No schema change.** `BINARY_SCHEMA_VERSION` stays `2`; no migration. Additive → next available MINOR at acceptance (Step 6). No new runtime dependency (root or `ui/`).

**6 steps, ONE consolidated Code Reviewer gate (Step 5).** Foundations land bottom-up (Step 1 backend endpoint → Step 2 UI data layer → Step 3 board-detail kanban → Step 4 Overview wall), then the single reviewer pass over the whole diff, then acceptance + version bump + audit + merge (Step 6).

## 2. Branching & merge strategy

- Create `feature/phase-09-kanban-inspector` from `main`.
- Commit per step. ONE Code Reviewer pass (Step 5).
- Fast-forward merge to `main`, no squash, tag **`phase-09-complete`**.
- **The release tag is NOT pushed by the agent** — it is the operator trigger for `publish.yml`. The agent stops at `phase-09-complete`, everything publish-ready + dry-run-verified.

## 3. Implementation order

### Step 1 — Board-columns aggregate + HTTP endpoint (Backend Engineer)

The net-new server foundation (spec §3.3).

**Reads aggregate (`getBoardColumns`).** Add to the **storage/reads layer**. **Recommended: co-locate in `src/storage/repositories/tasks.ts`** so the module-private `rowToTask` mapper (NOT exported today) is reused for free. If instead a new `src/storage/repositories/board-columns.ts` is created, **export `rowToTask` from `tasks.ts`** [N1]. **Do NOT place it under `src/mcp/tools/`** (C6 — it must be structurally not-a-tool). Signature roughly:
```ts
getBoardColumns(deps, boardId: string, opts: { limit: number }): Promise<BoardColumnsResult>
```
Algorithm (B1 + B2 — group-list-driven, groups from substrate-as-code, counts from SQLite):
1. `deps.loadSubstrate()` → resolve the board by id (**not found → the same not-found error `getBoardSubstrateHandler` raises**, which the route maps to 404). Take `board.groups`, filter `archived_at === null`, sort by `position` asc — the column list.
2. **One count query** (the project's first `GROUP BY`): `SELECT group_id, COUNT(*) AS n FROM tasks WHERE board_id = ? AND archived_at IS NULL GROUP BY group_id` → `Map<group_id, total>`. **Parameterized libsql `{ sql, args }`**, never string-concatenated (the `tasks.ts` convention).
3. For each active group: `total` = map.get(id) ?? 0; **preview** = active tasks in that group `ORDER BY updated_at DESC LIMIT ?` (a per-group query loop is acceptable — groups are bounded by board config; if a board ever has many groups, the windowed-query alternative is the documented fallback). Reuse the existing row→`Task` mapper from `tasks.ts` so `custom_data` JSON parsing etc. stays identical.
4. Emit `columns` in active-group order. A `group_id` in the count map but absent from the active-group set is **never read out** (archived/missing-group tasks omitted for free — the §4 edge rows fall out of this).

**Result type** (shared with the UI via the existing types pattern):
```ts
interface BoardColumn { group_id: string; group_name: string; position: number; color: string | null; total: number; tasks: Task[]; }
interface BoardColumnsResult { board_id: string; columns: BoardColumn[]; }
```

**HTTP route (`src/http/routes/api/index.ts`).** Register `app.get('/api/boards/:id/columns', …)` **inside `registerApiRoutes`, before the static SPA fallback** (so an unknown `/api/...` still hits the `/api/*` 404 guard in `static.ts`). It calls `getBoardColumns` **directly** (the first `/api` route not wrapping an MCP handler — documented in a comment citing `/api/health` as precedent).
- **`limit` validation (B3 — partly like `page_size`, with ONE deliberate divergence).** Read via the existing `intParam` (`query.ts`), which 400s on a **non-integer** (exactly like `page_size`). Then a Zod shape `z.object({ limit: z.number().int().positive().transform(n => Math.min(n, KANBAN_COLUMN_LIMIT)).default(KANBAN_COLUMN_LIMIT) })`:
  - **non-integer** → 400 (via `intParam`); **negative/zero** → 400 **via the Zod `.positive()`** — NOT via `intParam` (`Number('-5')` is a valid integer, so `intParam` passes it; do not drop `.positive()`). [C2]
  - **valid-but-huge** → **clamped** to `KANBAN_COLUMN_LIMIT` (the `.transform` `Math.min`). This is **intentionally UNLIKE `page_size`**, which *rejects* `page_size=9999` with a 400 (`pagination.ts` `.max()` + `api.test.ts`); here a huge `?limit` is a harmless over-ask, so we clamp rather than error. The Step 1 test asserts `?limit=99999999 → 200` with `tasks.length ≤ KANBAN_COLUMN_LIMIT` (NOT a 400 — don't let a reviewer "correct" this to match `page_size`). [C1]
  - absent `limit` → default `KANBAN_COLUMN_LIMIT`.
- `KANBAN_COLUMN_LIMIT` is a named const (e.g. `100`) in a shared spot the route + reads layer import.
- Board not found → 404 (same shape/handler-error mapping as `GET /api/boards/:id`). Archived board → still served (no archived-board guard, consistent with the current board endpoint).

**Tests (spec §5):** `board-columns.test.ts` (reads layer) + extend the HTTP api route tests:
- counts per active group correct; columns ordered by `position` asc; tasks within a column `updated_at desc`;
- `limit` caps `tasks` but not `total`; valid-but-huge clamps to `KANBAN_COLUMN_LIMIT`; **negative/non-numeric `?limit` → 400**;
- archived group excluded as a column; archived task excluded from `total`+`tasks`; a task whose `group_id` is archived/missing is omitted (group-list-driven, B2);
- empty board (no active groups) → `columns: []`; active group with no tasks → `{ total: 0, tasks: [] }`;
- board not found → 404; archived board still served;
- read-fresh: a group edit between two calls is reflected.

Commit: `feat(http): GET /api/boards/:id/columns aggregate (counts + capped preview) (Step 1)`.

### Step 2 — UI data layer: `getBoardColumns` client + `usePolling` hook (Frontend Engineer)

The client + the polling primitive, with no visual change yet (spec §3.6).

**API client (`ui/src/lib/api.ts`).** Add `getBoardColumns(boardId, { limit }): Promise<BoardColumnsResult>` and the `BoardColumn`/`BoardColumnsResult` types (mirror the server types). GET-only, consistent with the rest of the client.

**`usePolling<T>` hook (`ui/src/lib/usePolling.ts`) — modeled on `usePaginated`, NOT `useResource` (C1).** Do **not** touch `useResource` (its reset-on-deps loading flash is load-bearing for navigation in BoardDetail/Overview/TaskDetail). Reuse `usePaginated`'s **`fetchRef`** (capture latest closure) + **`tokenRef`** (ignore stale resolutions) discipline. API:
```ts
usePolling<T>(fn: () => Promise<T>, deps: unknown[], opts?: { intervalMs?: number }):
  { data: T | null; error: Error | null; loading: boolean; isPolling: boolean; paused: boolean; lastUpdated: number | null }
```
Behavior (locked):
- **First load** sets `loading: true` (gate on a `hasLoadedRef` / `data === null`). **Interval ticks** refresh `data` **in place** — never flip `loading` back to true, never clear `data`.
- **`deps` change** resets to loading (new resource — e.g. navigating boards); an interval tick does not (token pattern).
- **Page Visibility:** `document.hidden` → pause the interval (`paused: true`); on visible → refetch immediately, resume.
- **Interval:** named const `POLL_INTERVAL_MS` (target `4000`).
- **Error after first load:** keep last good `data`, expose `error`/an `isPolling` "reconnecting" signal, keep polling. A failed **first** load → `error` set as today.
- Hook stays **type-agnostic** — no task/group knowledge (moved-card diff is the consumer's job, Step 3, C2).

**Tests (`usePolling.test.ts`, Vitest + jsdom, fake timers + mocked `document.hidden`):**
- first load shows loading; a background tick updates data **without** flipping to loading / clearing data;
- pauses when `document.hidden`, refetches on visibility regain;
- `deps` change re-enters loading; stale resolution after a deps change is ignored (token);
- a failed background poll preserves last good data and keeps polling.

Commit: `feat(ui): getBoardColumns client + visibility-aware usePolling hook (Step 2)`.

### Step 3 — Board detail → kanban (default) + List toggle (Frontend Engineer)

The headline UI (spec §3.4, §3.7). Route unchanged; layout via `?view` search param.

**Kanban primitives (`ui/src/components/`):** `KanbanBoard` (horizontal column row + horizontal-scroll container), `KanbanColumn` (header: group name + `total` + optional `Group.color` left-accent; **bounded height** `max-h-[calc(100vh-…)]` + `overflow-y-auto`), `KanbanCard` (compact: title `Link`→`/tasks/:id`, relative `updated_at`, ≤1–2 custom-field chips), `LiveIndicator` (pulsing dot + "live · updated Ns ago" / "reconnecting…" / "paused"), `ViewToggle` ("Board | List"). Reuse `Card`/`Badge` tokens (exact card class from `Card.tsx`).

**Pulse animation (`ui/src/styles.css`):** add a small `@keyframes` block for the ~1.5 s one-shot moved-card highlight (no Tailwind utility covers it). Only theme change.

**Moved-card diff (consumer-side, C2):** a small `useMovedTasks(columns)` helper keeps a ref of the previous `taskId → group_id` map; on each new `columns`, returns the set of task ids whose group changed or that are new. `KanbanCard` applies the pulse class when its id is in that set.

**`BoardDetail.tsx` rework:**
- Read `?view` via `useSearchParams`; default + unknown → `kanban` (§4). Read `?group` (for the List deep-link, below).
- **Header:** board name stays the page title; move the long **description**, **Field schema**, **Policies** into a **collapsed-by-default disclosure** ("Board details"). The `ViewToggle` + `LiveIndicator` sit in the header.
- **Kanban view:** `usePolling(() => getBoardColumns(id, { limit: KANBAN_COLUMN_LIMIT }), [id], { intervalMs: POLL_INTERVAL_MS })` feeds `KanbanBoard`. Demoted header detail still comes from the existing `getBoard(id)` (`useResource`, one-shot — it's substrate-as-code, no need to poll it). Column overflow: when `total > tasks.length`, foot with **`+N more — open List`** → `?view=list&group=<group_id>`.
- **List view (`?view=list`):** render the **existing `TaskTable` unchanged** — search / group `<select>` / archived / cursor pagination intact.
  - **`?group` deep-link wiring (C3 — net-new):** `TaskTable` gains an `initialGroupId` (read from `?group`), seeds its `groupId` state from it so the table lands **pre-filtered** (drives the existing `in_groups` param to `getTasks`); `search`/`archived` stay independent.

**Scroll axes (C7):** board-detail = **two** axes (row horizontal, column vertical w/ bounded height). Don't add a third.

**Tests (extend `BoardDetail` tests / add `Kanban*.test.tsx`, Vitest + jsdom):**
- columns render in `position` order; cards bucket under the correct `group_id`; `total` shown; `+N more` appears iff `total > K` and links to `?view=list&group=<id>`;
- `?view=list` renders the table (search/filter/archived intact); default/unknown `?view` → kanban;
- `?view=list&group=<id>` lands pre-filtered (assert `getTasks` carried `in_groups=<id>` and the `<select>` reflects it); `search`/`archived` independent;
- "Board details" disclosure renders description/schema/policies, collapsed by default;
- moved-card diff: two `columns` snapshots where a task changed group → exactly that id flagged moved (pulse class applied).

Commit: `feat(ui): board detail kanban view + List toggle + live polling (Step 3)`.

### Step 4 — Overview → multi-board kanban wall (Frontend Engineer)

Spec §3.5, §3.7. Route unchanged (`/`).

**`Overview.tsx` rework:** replace the board-cards grid with a **vertical stack of board sections**. For each **non-archived** board (existing `getBoards({ archived: false })` — already excludes archived, C8): a slim header (board name `Link`→`/boards/:id`, truncated description) above a **horizontal column strip** (mini-columns: group name + `total`, ≤`K` preview cards (title `Link`→`/tasks/:id`), then `+N more` → `/boards/:id`).
- **Data — fan-out bounded by board count (C5):** one `getBoardColumns(boardId, { limit: OVERVIEW_PREVIEW_LIMIT })` per board (`OVERVIEW_PREVIEW_LIMIT` const, e.g. `4`), run in parallel, refreshed by **one `usePolling` tick** for the whole wall. Per-board error isolation: a failed board section shows an inline error; others render. (Comment the accepted `loadSubstrate`×B-per-tick cost and the deferred `/api/overview` optimization.)
- **Scroll axes (C7):** page vertical + strip horizontal = **two** axes. **Overview mini-columns do NOT scroll vertically** (≤`K` then `+N more`).
- Empty project (no boards) → current empty-state, unchanged.

**Tests (extend `Overview` tests):** one strip per non-archived board; mini-columns ordered by `position`; `+N more` → `/boards/:id`; per-board error isolation (one failing board doesn't blank the page); empty project unchanged.

Commit: `feat(ui): Overview multi-board kanban wall (Step 4)`.

### Step 5 — Code Reviewer gate (ONE consolidated pass)

Single Code Reviewer pass over the whole Step 1–4 diff. Focus:
- **Read-only invariant:** no mutation anywhere; client GET-only; the new route is `GET`; `ApiDeps` still omits `root`.
- **MCP surface unchanged:** `getBoardColumns` is NOT under `src/mcp/tools/`, not registered as a tool; the 29-tool count / `whoami` identity untouched.
- **SQL:** parameterized; the `GROUP BY` + per-group preview correct; archived filtering on both; row→`Task` mapper reused (no `custom_data` parsing drift).
- **`limit` validation** matches `page_size` (400 on non-int; clamp on huge).
- **`usePolling`** doesn't regress `useResource`; no loading-flash on interval ticks; visibility pause works; no memory leak (interval + listener cleaned up on unmount).
- **`?view`/`?group`** via `useSearchParams`; route table unchanged; deep-link pre-filter works.
- **No new dependency** (root + `ui/`); scroll axes as specified.

Address blockers; re-review if structural. Commit fixes as `fix(...) (Step 5 review)`.

### Step 6 — Acceptance, version bump, docs, audit, merge

- **Version (assign NOW, at acceptance — do NOT reuse 7b/8's `0.3.0`).** Next available MINOR above what has actually shipped. **4 sources + 1 guard:** `src/core/version.ts` `BINARY_VERSION`; `package.json` `version`; `ui/package.json` `version` (it carries `0.0.1` — bump it) [N3]; `src/mcp/tools/read/whoami.ts` `PHASE_STRING` → the **only substantive whoami edit is the parenthetical suffix** → `(kanban inspector)` (the `v${BINARY_VERSION}` prefix is templated, so the guard can't drift as long as the literal is untouched); `CHANGELOG.md` new entry. Guard: `whoami.test.ts` `PHASE_STRING ⊇ BINARY_VERSION` (update its copy assertion to match the new suffix). `BINARY_SCHEMA_VERSION` stays `2`.
- **CHANGELOG + README:** UI-section note — board view is now kanban (columns by workflow group) with a List toggle, the Overview shows all boards as a live wall, and the inspector auto-refreshes as agents move tasks. Keep the read-only framing.
- **Full gate:** `pnpm test` (unit+integration), `tsc` (root + ui), `eslint`, `prettier`, `pnpm build` (server + ui), UI Playwright smoke (extend `tests/smoke/ui.spec.ts`: kanban renders ≥1 column + a card; toggle to List shows the table; Overview renders **≥1 board strip with a column and a card** — the smoke seed is single-board, so either extend `ui-seed-and-serve.ts` to seed a 2nd board OR phrase the assertion for ≥1 strip, do NOT assert literal multiple boards against the 1-board seed [N5]; live indicator present), concurrency smoke. `pnpm publish --dry-run` lists only `dist/**` + the three root docs + `package.json`; confirm `package.json` **and** `ui/package.json` deps unchanged.
- **Assistant audit** (`.agents/audits/phase-09-audit.md`): acceptance checklist vs. the spec DoD.
- **Merge:** fast-forward to `main`, no squash, tag `phase-09-complete`. Agent does NOT push the release tag.

## 4. Risks & notes

- **First aggregate query in the codebase** — keep it parameterized and reuse the `Task` row mapper; this is the main correctness surface (Step 1, B1/B2).
- **Polling correctness** (no loading-flash on ticks, listener/interval cleanup) is the main UI subtlety (Step 2, C1).
- **The `?group` deep-link is net-new wiring**, not "reuse the existing filter" — easy to under-build (Step 3, C3).
- **Version collision** with the unbuilt 7b/8 (both at `0.3.0`) — resolved by assigning the number at Step 6, not in the spec/plan.

## 4b. Plan Reviewer resolutions (v1.1)

Architect Reviewer verified the plan against the real code (APPROVE-WITH-CHANGES). Confirmed accurate: `rowToTask` reusable, parameterized `{sql,args}`, no existing COUNT/GROUP BY, `archived_at IS NULL` active filter, `updated_at DESC` sort, `intParam` 400s on non-int, `registerApiRoutes` before `registerStaticFallback` + the `/api/*` 404 guard, `getBoardSubstrateHandler` not-found shape + groups-from-`loadSubstrate`, `usePaginated`'s fetchRef/tokenRef vs `useResource`'s reset-on-deps, BoardDetail's local `groupId` useState, `getBoards({archived:false})`, the api-client shape, and the seeded smoke harness. Incorporated:
- **C1** — `?limit` huge → **clamp** (intentionally UNLIKE `page_size`, which rejects); test asserts 200 + capped, not 400. (Step 1)
- **C2** — negative/zero `?limit` → 400 via Zod **`.positive()`**, not `intParam`. (Step 1)
- **N1** — `rowToTask` is module-private; co-locate in `tasks.ts` (recommended) or export it. (Step 1)
- **N3** — `ui/package.json` carries `0.0.1` → bump; whoami edit is just the suffix. (Step 6)
- **N5** — single-board smoke seed; relax the wall assertion or seed a 2nd board. (Step 6)
- **N2/N4** (no change): `/api/health` registered separately but new route still goes in `index.ts`; `/boards` (`Boards.tsx`) left untouched, consistent with spec §3.5.

## 5. Definition of Done

Spec DoD met: `GET /api/boards/:id/columns` (group-list-driven aggregate, `page_size`-style `limit` validation, HTTP-only/non-MCP placement); board detail kanban-default + List toggle + `?view`/`?group` deep-link + demoted header; Overview multi-board wall bounded by board count; visibility-aware `usePolling` + consumer-side moved-card diff; pinned scroll axes; full test suite (server/UI/hook/smoke) green; read-only contract and MCP surface intact; no new dependency; version bumped via the 4-source+1-guard lockstep; `phase-09-complete` tagged; release tag left to the operator.
