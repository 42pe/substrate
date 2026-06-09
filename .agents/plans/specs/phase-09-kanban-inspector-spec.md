# Phase 9 Spec — Kanban inspector (board view as columns + live polling)

**Status:** APPROVED (incorporates Architect Reviewer changes; B1–B3 + C1–C8 resolved) — ready for planning.
**Standing directive:** Diego's standing instruction is to proceed without per-phase approval pauses; no separate confirmation gate is required before planning begins.
**Author:** Spec Team
**Last updated:** 2026-06-06
**Architecture plan:** [`../v1-architecture.md`](../v1-architecture.md)
**Predecessor / context:** Phase 5b shipped the read-only React inspector (Overview → board cards; BoardDetail → groups-as-pills + flat task table; TaskDetail). Phases 7b (error logging) and 8 (shareable templates) are specced-but-unbuilt and both currently target `0.3.0` — see §6 on version sequencing. Shipped binary is `0.2.1`.

Product decisions already locked by the owner (the three forks below were answered before this draft):
1. **Overview** → a stacked multi-board kanban "wall": each board a horizontal strip of columns, boards stacked vertically; columns show a count + a capped preview of cards (`+N more`); fed by one aggregate endpoint.
2. **Board detail** → kanban is the **default** layout; the existing flat table is **retained as a "List" toggle** (keeps its search / group filter / archived toggle).
3. **Liveness** → **polling** (~3–5 s), visibility-aware (pause when the tab is hidden, refetch on re-show), diff the result and **pulse** a card that changed column.

---

## 1. Goal

Make a board **reviewable at a glance** by rendering its workflow as **kanban columns** (one per group, left-to-right in `position` order) instead of a flat table, and make the inspector **reflect agent activity live** — when an agent moves a task between groups via MCP, the board updates on its own within a few seconds, with the moved card briefly highlighted.

This is a **UI + one read-only aggregate endpoint** change. No data-model change, no MCP tool-surface change, no write path. The inspector stays **read-only by contract**.

## 2. Scope

**In scope:**
- **A board-columns aggregate read** (`GET /api/boards/:id/columns?limit=<K>`) returning, per active group (ordered by `position`), the **total task count** and a **capped, ordered preview** of that group's active tasks (§3.3). Backed by a new reads-layer function; **not** added to the MCP tool surface (§3.3 rationale).
- **Board detail → kanban (default) + List toggle** (§3.4): columns by `group.position`; cards reuse the existing card visual language and link to `/tasks/:id`; board description / field-schema / policies demoted into a collapsible header so columns lead; a `?view=kanban|list` query param selects the layout (default kanban); **List** renders the **existing** task table unchanged (search / group filter / archived intact).
- **Overview → multi-board kanban wall** (§3.5): each non-archived board a horizontal column strip (count + top-`K` cards + `+N more`), boards stacked vertically; strips scroll horizontally independently; the page scrolls vertically.
- **Live polling** (§3.6): a visibility-aware polling data hook; background refreshes update in place (no loading flash); a diff highlights cards that changed group since the last poll; a subtle "live · updated Ns ago" affordance.
- **Kanban UI primitives** (§3.7): `Column`, `KanbanCard`, and a `useColumns`/polling hook, styled consistently with the existing `Card`/`Badge` tokens; optional use of `Group.color` as a column accent.
- **Tests** (§5); **CHANGELOG + README** UI-section touch-ups; **version bump** at acceptance (§6).

**Out of scope (non-goals — named):**
- **Drag-and-drop / any write from the UI.** The inspector is read-only by contract (Phase 5b R-P5-3 lineage; agents mutate via MCP). Cards are **not** draggable; moving a task is an agent action, not a UI gesture. "Updates as tasks move" = polling reflecting agent moves, **not** user dragging. **This is the headline non-goal.**
- **Intra-column manual ordering / a task rank field.** `Task` has no rank; columns order by `updated_at desc` (most-recently-touched on top — §3.3). No new persisted ordering field, no schema change.
- **Server push (SSE / WebSocket).** Polling only (owner-chosen). No new transport, no broadcast plumbing.
- **A project-wide single aggregate endpoint.** The wall calls the per-board endpoint once per board (bounded by **board count**, not task count — §3.5). No `/api/overview` mega-payload in v1.
- **Per-column independent pagination / infinite scroll within a kanban column.** A column shows up to a generous cap; the long tail is handled by the retained **List** view (which keeps the existing cursor pagination + search). This is the division of labor that justifies keeping the table (§3.4).
- **Mobile/narrow-viewport redesign.** Desktop localhost inspector; columns scroll horizontally. Documented, not optimized for small screens in v1.
- **Adding a kanban/aggregate tool to the MCP surface.** Agents already have `list_tasks` with `in_groups`; the columns aggregate is a UI-serving HTTP route only — the 29-tool MCP contract is unchanged (§3.3).

## 3. Design

### 3.0 Locked decisions

1. **Read-only, no DnD.** Columns reflect state; they never edit it. No drag, no inline move, no write call anywhere in this phase.
2. **Columns = active groups, ordered by `position`.** Archived groups are **not** columns (their tasks surface only in List view). A task whose `group_id` resolves to an archived or non-existent group is **omitted** from the board (visible in List) — no synthetic "Ungrouped" column in v1 (§4).
3. **Cards = active tasks**, ordered **`updated_at desc`** within a column (also makes a just-moved card jump to the top, reinforcing the live feel). Archived tasks are **excluded** from kanban (List view's archived toggle still shows them).
4. **Board detail default = kanban**; **List** is a one-click toggle persisted in the URL (`?view=list`). List = the **current table, unchanged**.
5. **Overview wall = capped preview** (count + top-`K` cards + `+N more`); full fidelity is the per-board kanban you click into.
6. **Liveness = polling**, visibility-aware, in-place refresh, moved-card pulse. Interval is a single named constant (target 4 s; spec range 3–5 s).
7. **One new HTTP read endpoint**, backed by a reads-layer aggregate; **no MCP tool added**, **no schema change**.

### 3.1 Why kanban (and why a table still exists)

The substrate **is** an ordered-column workflow: `Group.position` defines column order and `transition_guard` policies govern column-to-column moves. The Phase 5b flat table (TITLE · GROUP · UPDATED) encodes the column in a *cell* the reader must scan and bucket mentally — it hides the one structure that matters for review. Kanban makes the workflow the layout.

The table is **not** deleted because it is strictly better for two jobs kanban is worse at: (a) free-text **search** and cross-group **filtering**, and (b) **long** columns (50+ tasks) where a wall of cards is worse than rows. So kanban is the default *review* surface; List is the *find/triage* surface and the overflow target for tall columns. Keeping both is a deliberate division of labor, not indecision.

### 3.2 Read-only contract (restate, because "kanban" implies DnD to most readers)

Every existing read endpoint and the new one are `GET`-only. The UI issues no mutations. The "live" behavior is **observational**: the agent moves a task (MCP write) → the next poll observes the new `group_id` → the card renders in its new column with a transient highlight. There is no optimistic update, no local move, no rollback — there is nothing to roll back. A reviewer expecting drag-to-move should read this section: that capability is intentionally absent.

### 3.3 Board-columns aggregate endpoint

**`GET /api/boards/:id/columns?limit=<K>`** → 200:
```jsonc
{
  "board_id": "…",
  "columns": [
    {
      "group_id": "…",
      "group_name": "Backlog",
      "position": 0,
      "color": null,            // Group.color, may be null
      "total": 12,              // count of ACTIVE tasks in this active group
      "tasks": [ /* up to K active tasks, updated_at desc */ ]
    }
    // … one entry per ACTIVE group, in position order
  ]
}
```
- **`limit` (K):** optional, clamps the per-column `tasks` array. Default a generous board-detail cap (named const, e.g. `KANBAN_COLUMN_LIMIT = 100`); the Overview wall passes a small `K` (e.g. `4`). `total` is **always the true count**, independent of `K`, so `total > tasks.length` drives the `+N more` affordance.
- **`limit` validation (B3 — match the existing `page_size` convention, do NOT silently default a non-number).** The HTTP layer's established pattern (`src/http/routes/api/query.ts`) is: coerce with `intParam` (which **throws a 400 `schema_violation` on a non-integer**, exactly like `page_size` does today) → `validateInput` against a Zod shape. Phase 9 follows it: a **non-integer / negative** `?limit` → **400 `schema_violation`** (not a silent default); a **valid-but-too-large** `?limit` is **clamped** to `KANBAN_COLUMN_LIMIT` via a `z.number().int().positive().transform(n => Math.min(n, MAX))` so a hostile/typo'd `?limit=99999999` can't blow up the response. (This corrects the earlier "non-numeric → default" wording — see the §4 row.)
- **Algorithm (B1 + B2 — own that this is the project's FIRST aggregate/count query, and that groups live in substrate-as-code, NOT SQLite).** Groups are read from `boards/<id>.json` via `deps.loadSubstrate()` (as `get_board_substrate` does); tasks carry only a `group_id` **string FK** in SQLite (unenforced FK). There is **no existing count helper** — `listTasks` is cursor-only and never computes a total. So `getBoardColumns(boardId, { limit })` is net-new and the iteration is **driven by the group list, not the task rows**:
  1. `loadSubstrate()` → take `board.groups`, **filter active** (`archived_at === null`), **sort by `position` asc** — this is the column list.
  2. **One count query** over active tasks: `SELECT group_id, COUNT(*) AS n FROM tasks WHERE board_id = ? AND archived_at IS NULL GROUP BY group_id` → a `Map<group_id, total>`. Parameterized libsql `{sql, args}`, **never** string-concatenated (the `tasks.ts` convention).
  3. For **each active group**, read `total` from the map (absent → `0`) and fetch its **bounded preview**: active tasks in that group, `ORDER BY updated_at DESC LIMIT K`. A **per-group preview loop is acceptable** — groups are few (board config, not unbounded) — but the plan must pin the bound and note the alternative (one windowed query) if a board ever has many groups.
  4. Emit columns in the active-group order; **a `group_id` present in the count map but NOT in the active-group set is never read out** → a task in an archived/missing group is **omitted from the board for free** (the §4 "integrity slip" / archived-group rows fall out of this, no special-casing).
- **Active-only (restated):** columns = active groups only; `tasks` = active tasks only; `total` counts active tasks only. Archived groups/tasks live in List view, never on the board.
- **Board not found / archived board:** `:id` not found → 404 (same shape as `GET /api/boards/:id` today — `getBoardSubstrateHandler` 404s only on not-found). An **archived** board is still readable (no archived-board guard on the current board endpoint) — its active groups still render as columns; the Overview wall simply doesn't list archived boards (§3.5).
- **HTTP-only, NOT an MCP tool, and NOT under `src/mcp/tools/` (C6 — confirmed correct).** Place `getBoardColumns` in the **storage/reads layer** (`src/storage/repositories/tasks.ts`, or a new `boards-columns.ts` reads module) and have the HTTP route in `src/http/routes/api/index.ts` call it directly — the way every other `/api` route wraps a handler, except this is the **first** `/api` route backed by a reads function with **no** MCP handler. Do **not** put it under `src/mcp/tools/read/` (it would look like an unregistered tool and muddy the 29-tool narrative). Agents don't need a kanban view (they have `list_tasks` + `in_groups`), so the MCP surface / `whoami` identity stays stable. Precedent: `/api/health` is already an HTTP-only route with no MCP twin. Register the route in `registerApiRoutes` (before the static SPA fallback) so an unknown `/api/...` typo still hits the `/api/*` 404 guard.
- **Freshness:** read fresh per request (substrate-as-code groups via `loadSubstrate()`; task rows from SQLite). Polling re-hits this endpoint.

### 3.4 Board detail → kanban (default) + List toggle

Route unchanged (`/boards/:id`); layout selected by **`?view`** (`kanban` default, `list` opt-in) so the choice is deep-linkable and shareable (consistent with the SPA deep-link support). **`?view` is a search param, read via React Router v7's `useSearchParams` — the route table (`main.tsx`) needs no change** (C4). Use the **query param, not localStorage**: shareable, deep-link-consistent, and it composes with the `?group=` overflow link below (localStorage would make `+N more → List` non-deterministic). Absent/unknown `?view` → `kanban`.

**Header (demoted reference material).** The board name stays as the page title. The long board **description**, **Field schema**, and **Policies** cards move into a **collapsible disclosure** ("Board details") that is **collapsed by default** (or rendered as a slim one-line summary) so the columns are immediately visible — fixing the current "tasks are dead last, below three config sections" hierarchy. A small **view switch** ("Board | List") and the **live indicator** (§3.6) sit in the header.

**Kanban view (default).**
- A horizontal flex row of **columns**, one per active group in `position` order. Each column: a header (group name, `total` count, optional `Group.color` accent strip), and a vertical stack of **cards**. The row scrolls horizontally when columns overflow the viewport; each column scrolls vertically if tall (bounded height).
- **Cards** reuse the existing card token (`rounded-lg border border-neutral-200 bg-white shadow-sm`), compact: task **title** (link → `/tasks/:id`), `updated_at` (relative), and at most one or two custom-field chips if present; an `archived` badge never appears here (archived tasks are excluded). Card click → existing TaskDetail route (unchanged).
- **Overflow + the deep-link wiring it requires (C3 — net-new, currently unscoped in Phase 5b).** If `total > tasks.length`, the column foots with **`+N more — open List`** linking to **`?view=list&group=<group_id>`**. Today the `TaskTable` group filter is **purely local React state** (`const [groupId, setGroupId] = useState('')` → a `<select>`); there is **no URL→filter wiring**. So this reuses the *mechanism* (the `in_groups` query param to `getTasks`) but needs **new** code: `TaskTable` must **read `?group` from the URL and seed its `groupId` state** (e.g. a new `initialGroupId` prop or a `useSearchParams` read), keeping `search`/`archived` independent. A test asserts the deep-link lands on a table pre-filtered to that group. This is how tall columns degrade gracefully without per-column pagination — the List view's existing cursor pagination (25/page) + text search is the overflow home.
- **Empty board / empty column:** a column with zero tasks renders its header + an empty-state hint; a board with zero active groups renders a "No groups yet" message (mirrors current empty handling).

**List view (`?view=list`).** Renders the **existing** `TaskTable` exactly as today — search box, group `<select>`, archived checkbox, cursor pagination — **unchanged**. Switching views preserves the board context. (The current group-filter `<select>` is the mechanism the `+N more` deep-link drives.)

Data: kanban view fetches `GET /api/boards/:id/columns?limit=KANBAN_COLUMN_LIMIT` (one call replaces the table's task fetch in this layout) plus the existing `GET /api/boards/:id` for the demoted header detail. List view keeps its current two-call shape.

### 3.5 Overview → multi-board kanban wall

Route unchanged (`/`). Replaces the board-cards grid with a **vertical stack of board sections**:
- Each **non-archived** board (from the existing `GET /api/boards?archived=false`) renders a slim section header (board name → link to `/boards/:id`, optional truncated description) above a **horizontal column strip**.
- Each strip shows that board's active groups as mini-columns: **group name + count**, then up to **`K` (3–5, named const, default 4)** preview cards (title link → `/tasks/:id`), then **`+N more`** → the board's kanban (`/boards/:id`). Strips scroll horizontally independently; the page scrolls vertically. This is exactly the owner's "all boards stacked, columns scroll sideways" layout, density-capped.
- **Data shape — bounded by board count, not task count.** The wall fetches `GET /api/boards/:id/columns?limit=K` **once per board** (N calls, N = number of boards, typically a handful on localhost). No project-wide mega-endpoint (§2 non-goal). The N calls run in parallel; a single poll tick refreshes the whole wall (§3.6). If a board's columns call fails, that one board section shows an inline error and the rest still render (per-board isolation).
- **Cost trade-off (C5 — pin it so it isn't a surprise).** Each columns call does a fresh `loadSubstrate()` (reads **all** `boards/*.json` from disk, no caching) plus the new count+preview SQL. So a wall with B boards re-reads the entire substrate-as-code **B times every poll tick**. On localhost with a handful of boards this is fine — that is the price of *not* building the single `/api/overview` aggregate (which would `loadSubstrate` once). That mega-endpoint is the documented future optimization (§2 non-goal); the per-board fan-out is the accepted v1 cost. If a project ever has many boards, that's the trigger to build it.
- **Empty project** (no boards) → the current empty-state message, unchanged.

### 3.6 Live polling

**A NEW `usePolling<T>` hook — do NOT extend `useResource` (C1, locked).** `useResource` hard-resets to `{data:null, error:null, loading:true}` on **every** deps change; that reset-on-deps is load-bearing for the loading flash on navigation in BoardDetail / Overview / TaskDetail. Bolting an `intervalMs` mode onto it risks regressing those. Instead, model `usePolling` on **`usePaginated`**, which already solves the two hard parts: a **`fetchRef`** that captures the latest closure so a new closure each render doesn't retrigger work, and a **`tokenRef`** that ignores stale resolutions. `usePolling<T>(fn, deps, { intervalMs })` adds an interval + a Page Visibility listener on top of that ref discipline. Requirements (locked):
- **First load** shows the loading state (gate on `data === null` / a `hasLoadedRef`). **Background refreshes (interval ticks)** update `data` **in place** and **must not** flip `loading` back to true or clear `data` (no flicker / no content flash).
- **`deps` change vs. interval tick:** when `deps` change (e.g. navigating to a different `boardId`) the hook **does** reset to loading (it's a new resource) — but an **interval tick does not**. This is exactly `usePaginated`'s token pattern.
- **Page Visibility:** when `document.hidden`, **pause** the interval; on returning visible, **refetch immediately** then resume. (Don't poll a backgrounded tab.)
- **Interval:** one named constant, target **4000 ms** (spec range 3–5 s).
- **Error handling:** a failed background poll **keeps the last good data**, surfaces a subtle "reconnecting…" state, and keeps polling (no hard error screen once data has loaded once). A failed *first* load behaves as today (error state).
- **Type-agnostic — the moved-card diff lives in the CONSUMER, not the hook (C2).** A generic `usePolling<T>` can't know `T` contains tasks with `group_id`. The hook returns only `{ data, error, isPolling, paused, lastUpdated }`. The **kanban component** (or a small `useMovedTasks(columns)` helper that knows the shape) keeps the ref of the previous `taskId → group_id` map, and on each new `data` computes the set of task ids whose `group_id` changed (or that are newly present). Those cards get a **transient highlight** (a `@keyframes` pulse in `styles.css`, ~1.5 s, then fades) on next render. Because columns sort `updated_at desc`, a moved card also rises to the top of its new column. This keeps the hook reusable for both the single-board response and the wall's per-board responses.
- **Live indicator:** a small header affordance — e.g. a pulsing dot + "live · updated Ns ago" (relative, ticks); switches to "reconnecting…" on poll error, "paused" when the tab is hidden. Read-only, informational.

Both the board-detail kanban and the Overview wall use this hook.

### 3.7 UI primitives & styling

- New components under `ui/src/components/`: `KanbanBoard` (the column row + horizontal scroll container), `KanbanColumn` (header + count + accent + scroll area), `KanbanCard` (compact task card), `LiveIndicator`, and a `ViewToggle`. Reuse `Card`/`Badge` tokens; columns use neutral surfaces with an optional `Group.color` left-accent.
- **Scroll axes — pin them so an implementer doesn't add a third (C7).**
  - **Board detail kanban:** columns scroll **horizontally** (the row); each column scrolls **vertically** within a **bounded height** (e.g. `max-h-[calc(100vh-…)]` + `overflow-y-auto`) so a 100-card column doesn't blow out the page before the `K` cap applies. Two axes.
  - **Overview wall:** the page scrolls **vertically**; each board strip scrolls **horizontally**. **Overview mini-columns do NOT scroll vertically** — they show ≤`K` cards then `+N more`. Two axes, never three. (This avoids the classic trackpad nested-scroll trap.)
- Tailwind v4 CSS-first (`ui/src/styles.css`, currently empty of custom theme — clean slot): add a small `@keyframes` block for the moved-card pulse (no Tailwind utility covers a 1.5 s one-shot highlight out of the box, so this block is expected). Otherwise no theme change; keep the neutral palette.
- No new runtime dependency (no kanban/DnD library — there's no DnD). Confirm `ui/package.json` deps unchanged.

## 4. Edge cases

| Case | Expected |
|---|---|
| Board with zero active groups | kanban shows "No groups yet"; List view still available |
| Active group with zero active tasks | column renders header + count `0` + empty hint |
| `total` > preview length (`K`) | column foots with `+N more — open List` → `?view=list` filtered to that group |
| Task whose `group_id` is an **archived** group | omitted from kanban (no column for archived groups); visible in List |
| Task whose `group_id` matches **no** group (integrity slip) | omitted from kanban; visible in List; no synthetic column |
| **Archived** task | excluded from kanban (`total` and `tasks`); List view's archived toggle still shows it |
| **Archived** board | columns endpoint still serves it (consistent with current board endpoint); Overview wall does **not** list it |
| Board `:id` not found | 404 (same shape as `GET /api/boards/:id`) |
| `?limit=` valid but huge | clamped to `KANBAN_COLUMN_LIMIT` (via Zod `.transform` min) |
| `?limit=` negative / non-numeric | **400 `schema_violation`** (matches the existing `page_size` convention via `intParam`); NOT a silent default (B3) |
| `?view=` unknown value | treated as default (`kanban`) |
| Tab hidden / backgrounded | polling pauses; indicator shows "paused"; refetch on re-show |
| Background poll fails after first load | keep last good data; indicator "reconnecting…"; keep polling |
| First load fails | error state (as today) |
| Agent moves a task between polls | next poll: card appears in new column, top (updated_at desc), with a ~1.5 s highlight |
| Overview: one board's columns call fails | that board section shows inline error; other boards render |
| Empty project (no boards) | current empty-state, unchanged |
| Very tall column (100s of tasks) | capped at `K`; overflow via `+N more` → List (no per-column infinite scroll) |

## 5. Test strategy

**Server (the new endpoint + reads aggregate):**
- counts per active group are correct; ordering is `position` asc for columns and `updated_at desc` for tasks within a column;
- `limit` caps `tasks` but **not** `total`; valid-but-huge `limit` clamps to `KANBAN_COLUMN_LIMIT`; **negative/non-numeric `limit` → 400 `schema_violation`** (B3, matches `page_size`);
- iteration is **group-list-driven**: a `group_id` present in the count map but absent from the active-group set produces no column and is in neither `total` nor `tasks` (B2);
- archived groups excluded as columns; archived tasks excluded from `total`+`tasks`; a task in an archived/missing group omitted;
- empty board (no groups) → empty `columns`; group with no tasks → `total:0, tasks:[]`;
- board not found → 404; archived board still served;
- read-fresh (a group edit between calls is reflected).

**UI (Vitest + jsdom):**
- kanban renders columns in `position` order; cards bucket under the correct `group_id`; counts shown; `+N more` appears iff `total > K` and links to the group-filtered List;
- `?view=list` renders the existing table with search/filter/archived intact; `?view` default is kanban; unknown `?view` falls back to kanban;
- **`?view=list&group=<id>` deep-link (C3):** the table lands **pre-filtered** to that group (assert the `getTasks` call carried `in_groups=<id>` and the `<select>` reflects it); `search`/`archived` remain independent;
- the demoted "Board details" disclosure renders description/schema/policies and is collapsed by default;
- Overview wall renders one strip per non-archived board; per-board error isolation (one failing board doesn't blank the page).

**Polling hook (Vitest, fake timers + mocked Page Visibility):**
- first load shows loading; a background refresh updates data **without** flipping to loading / clearing data;
- pauses when `document.hidden`, refetches on visibility regain;
- moved-card diff: feed two snapshots where a task's `group_id` changed → the hook/consumer flags exactly that task id as moved;
- a failed background poll preserves last good data and keeps the indicator in "reconnecting".

**Playwright smoke (extend `tests/smoke/ui.spec.ts`):**
- board detail in kanban mode renders ≥1 column and a card under the expected column; toggling to List shows the table; Overview shows a multi-board wall. (No live-polling assertion in smoke — covered by the hook unit tests — but assert the live indicator is present.)

**Full gate:** `pnpm test` (unit+integration), `tsc` (root + ui), `eslint`, `prettier`, `pnpm build` (server + ui), UI Playwright smoke, concurrency smoke. `pnpm publish --dry-run` lists only `dist/**` + the three root docs + `package.json`; **no new dependency** (root or ui) — confirm both `package.json` and `ui/package.json` deps unchanged.

## 6. Version sequencing (resolve at acceptance — do NOT hard-pin now)

Additive; **`BINARY_SCHEMA_VERSION` stays `2`**, no migration. This phase takes the **next available MINOR** under the standard **4-source + 1-guard** lockstep (`src/core/version.ts` `BINARY_VERSION`, `package.json` `version`, `whoami.ts` `PHASE_STRING`, `CHANGELOG.md`; guard: `whoami.test.ts` `PHASE_STRING ⊇ BINARY_VERSION`).

**Coordination note (flag for the Architect Reviewer):** Phases 7b and 8 are **both** specced at `0.3.0` while unbuilt, so the literal number depends on build order. **Do not encode `0.3.0` here.** Assign this phase's number at merge time as the next minor above whatever has actually shipped (e.g. if 7b→`0.3.0` and 8→`0.4.0` land first, this is `0.5.0`). `PHASE_STRING` suffix: `(kanban inspector)`.

## 7. Operator tasks (NOT done by the agent)

Unchanged from prior phases: live `npm publish`, the real release-tag push, npm token/secret config remain Diego's. This phase ships in-repo + dry-run-verified; the agent stops at the `phase-09-complete` tag.

## 7b. Resolved decisions (Architect Reviewer)

The Architect Reviewer returned **APPROVE-WITH-CHANGES**. All blockers (B1–B3), concerns (C1–C8), and the open questions are resolved and folded into §3–§5. Recorded here for traceability:

**Blockers (resolved):**
- **B1 — `total` is net-new SQL, owned explicitly.** First aggregate/count query in the project; named the two queries (`GROUP BY` count + per-group `ORDER BY updated_at DESC LIMIT K` preview), parameterized libsql, per-group loop bound noted. §3.3.
- **B2 — groups come from `loadSubstrate()`, not SQLite; iteration is group-list-driven.** The count `GROUP BY` map is keyed out by the active-group set, so archived/missing-group tasks are omitted for free. §3.3.
- **B3 — `?limit` follows the `page_size` convention.** Non-integer/negative → 400 `schema_violation` (not a silent default); valid-but-huge → clamp via Zod `.transform` min. §3.3, §4, §5.

**Concerns (resolved):**
- **C1 — new `usePolling` hook modeled on `usePaginated`** (fetchRef + tokenRef + first-load-only loading); do NOT extend `useResource`. §3.6.
- **C2 — moved-card diff lives in the consumer**, hook stays type-agnostic. §3.6.
- **C3 — `+N more → List` needs new URL→filter wiring** (`?group=<id>` seeding `TaskTable`'s group state); named, with a test. §3.4, §5.
- **C4 — `?view` query param (not localStorage)**, via `useSearchParams`; route table unchanged. §3.4.
- **C5 — Overview fan-out cost pinned** (`loadSubstrate` × B per tick) as the accepted price of deferring `/api/overview`. §3.5.
- **C6 — HTTP-only placement confirmed**; `getBoardColumns` lives in the storage/reads layer, NOT under `src/mcp/tools/`; route registered before the SPA fallback. §3.3.
- **C7 — scroll axes pinned** (board detail = 2 axes w/ bounded column height; Overview = 2 axes, mini-columns never scroll vertically). §3.7.
- **C8 — confirmed correct, no change:** `getBoards({archived:false})` excludes archived boards; the columns endpoint serving an archived board matches the current board endpoint.

## 8. Definition of Done (for this spec)

**Status: APPROVED (B1–B3 + C1–C8 resolved) — ready for planning.** Goal (§1) and the three owner-locked forks (Overview wall / kanban-default-plus-List / polling) are specified with: the read-only-no-DnD headline non-goal (§3.0/§3.2), the board-columns aggregate endpoint + its net-new-SQL algorithm + deliberate HTTP-only (non-MCP) placement + `limit` validation (§3.3), the board-detail kanban + List toggle + `?view`/`?group` deep-link wiring + demoted header (§3.4), the Overview wall bounded by board count + its cost trade-off (§3.5), the visibility-aware in-place `usePolling` hook + consumer-side moved-card diff (§3.6), the new UI primitives + pinned scroll axes (§3.7), an edge-case table (§4), a test strategy covering server/UI/hook/smoke (§5), and the version sequencing caveat (§6). All reviewer items recorded in §7b. Per Diego's standing directive there is no separate approval pause: implementation PLAN → Plan Reviewer → development.
