# Phase 5b Spec — React Read-Only UI

**Status:** APPROVED (Diego, 2026-06-03) — §3.0 decisions locked; §7 recommendations all confirmed.
**Author:** Spec Team
**Last updated:** 2026-06-03
**Architecture plan:** [`../v1-architecture.md`](../v1-architecture.md) §5 Phase 5
**Predecessor:** Phase 5a (`phase-05a-complete`) — HTTP JSON read API (8 `GET /api/...` endpoints) + the Phase 1 UI shell (Vite + React 19 + Tailwind v4).

---

## 1. Goal

Ship the read-only inspector UI: a small React app that renders the project, boards, board detail (task list + filters), and task detail (description, custom_data, comments, events) by consuming the Phase 5a API. Author-supplied markdown is rendered through ONE sanitized path. One Playwright smoke proves the pages mount. This completes the v1 Web UI.

**Lighter, pragmatic stack** (Diego, 2026-06-03): ShadCN-style components + a small typed fetch client + minimal routing — not the full TanStack Router/Table/Query stack. It's a 4-page read-only inspector; ship it fast.

## 2. Scope

**In scope:**
- Build out `ui/` from the Phase 1 shell: routing, pages, components, the API client, the markdown sanitizer.
- 4 routes (CSR): `/` (overview), `/boards`, `/boards/:id`, `/tasks/:id`.
- ShadCN-style components (source-vendored, not via the CLI): `Card`, `Badge`, `Tabs`, `Table`, plus the `cn()` util.
- `ui/src/lib/api.ts` — typed fetch client over the 5a endpoints (types imported from `src/core/types.ts` via a Vite path alias).
- `ui/src/lib/markdown.ts` — `marked` → `DOMPurify` (browser). **The single markdown→HTML path; never bypassed.** A `<Markdown>` component is the only place `dangerouslySetInnerHTML` appears.
- Empty + error states on every page; a top-level error boundary + per-route loading.
- **SPA fallback:** `static.ts` serves `index.html` for any unmatched non-`/api`, non-`/assets` GET (so deep links work). Mounts AFTER `/api` (already ordered in 5a).
- **One Playwright smoke** (`tests/smoke/ui.spec.ts`): boots `substrate serve`, visits `/`, `/boards`, `/tasks/:id`, asserts each route mounts with no `console.error`.
- Sanitizer unit tests (crafted `<script>`, `onload`, `javascript:` URLs).

**Out of scope:**
- Authoring UI (no CRUD forms — reads only; v1).
- Substrate inspector page (`/inspect/:boardId`) — dropped from v1 (5a decision).
- TanStack Router / Table / Query (lighter stack chosen).
- Per-board task counts on the overview (deferred from 5a; the overview shows board cards without counts).
- Server-side markdown sanitization (UI-only — 5a decision).
- SSR / hot-reload in production (dev-only).

## 3. Design

### 3.0 Locked decisions (Diego, 2026-06-03)

1. **Lighter stack:** ShadCN-style components + typed fetch client + minimal routing (no TanStack Router/Table/Query).
2. **Build the Playwright smoke in 5b** (dev-dependency + browser download).
3. (From 5a:) UI-only DOMPurify sanitization; inspector dropped; no task counts.

### 3.1 New dependencies (`ui/`)

- `react-router-dom` (routing — mature, tiny, far less setup than TanStack Router for 4 routes).
- `marked` (markdown → HTML) + `dompurify` (browser sanitizer).
- ShadCN companions: `clsx`, `tailwind-merge`, `class-variance-authority`, `@radix-ui/react-tabs` (the only Radix primitive needed — Card/Badge/Table are plain styled elements). `lucide-react` for a few icons (optional).
- Dev: `@playwright/test` (one smoke).
- The `tar`-style "vendor the source" approach for ShadCN components (copy the component files in) avoids the ShadCN CLI + its Tailwind-v4 setup friction.

### 3.2 Routing + SPA fallback

- `react-router-dom` `createBrowserRouter` with 4 routes; a root layout (header/nav) + `<Outlet/>`.
- **Server SPA fallback (`static.ts`):** add a catch-all `app.get('*')` (registered last, after `/api` and `/assets/*`) that returns `index.html` for any other GET so a deep link (`/boards/:id`, `/tasks/:id`) loads the app. The origin allowlist still gates it; `/api` is unaffected (ordered first). This is the catch-all the 5a review anticipated — a test asserts `/api/project` still returns JSON (not the SPA HTML).

### 3.3 API client (`ui/src/lib/api.ts`)

- A typed `apiGet<T>(path): Promise<T>` that fetches, checks `res.ok` (throws an `ApiError` carrying the parsed `{ error: { code, message } }` on non-2xx), and returns the parsed JSON. Same-origin (the app is served by `substrate serve`), so no base URL.
- Typed wrappers: `getProject()`, `getBoards(params)`, `getBoard(id)`, `getTasks(params)`, `getTask(id)`, `getTaskHistory(id, params)`, `getComments(id, params)`, `getComment(id)`. Return types reuse `src/core/types.ts` (`Task`, `Comment`, `TaskEvent`, `Board`, `Group`, `Policy`) via a Vite alias (`@core` → `../src/core`).
- A small `useResource<T>(fn, deps)` hook: `{ data, error, loading }`. No TanStack Query.

### 3.4 Pages

| Route | Content | Empty / error |
|---|---|---|
| `/` Overview | Project name + description (markdown); a grid of board cards (name, description, archived badge) linking to `/boards/:id` | no boards → "No boards yet — author one via MCP"; API error → error card |
| `/boards` | Board list (table or cards), archived toggle | empty + error states |
| `/boards/:id` Board detail | Board header; groups as `Badge`s; field_schema summary; policies summary (name + type badge); a task `Table` (title, group, updated_at) with filters: group (in_groups), archived, text_search; each row links to `/tasks/:id` | no tasks → empty row; unknown board → not-found state (the API 404 → error card) |
| `/tasks/:id` Task detail | Title; description via `<Markdown>`; `custom_data` (key/value); `Tabs`: **Details** (fields) / **Comments** (thread; bodies via `<Markdown>`) / **Events** (history list) | no comments / no events → empty states; unknown task → not-found |

- Pagination: "Load more" using the API `next_cursor` (no infinite scroll). Default page sizes from the API.
- All times rendered readably (ISO → locale).

### 3.5 Markdown sanitizer (`ui/src/lib/markdown.ts`)

```ts
export function renderMarkdown(src: string): string {
  const rawHtml = marked.parse(src, { async: false }) as string;
  return DOMPurify.sanitize(rawHtml, { USE_PROFILES: { html: true } });
}
```
- `<Markdown source={...} />` renders `dangerouslySetInnerHTML={{ __html: renderMarkdown(source) }}` — the ONLY such usage in the app. A lint note / code comment marks it as the single rendering path.
- DOMPurify defaults strip `<script>`, event handlers (`onload=`), and `javascript:` URLs. Tests assert each.

### 3.6 Security

- The UI is same-origin; the API is already origin-gated (5a/Phase 1). No new server security surface except the SPA catch-all (still behind the allowlist).
- **The sanitizer is the security-critical surface** (R-P5-3): every author-supplied string (`description`, comment `body`, policy `message`) reaches the browser raw from the API and is rendered ONLY through `renderMarkdown`. The Code Reviewer audits for any rendering path that bypasses it.
- No secrets in the bundle; no auth (localhost-only v1).

## 4. Edge cases

| Case | Expected |
|---|---|
| markdown with `<script>alert(1)</script>` | renders the text, no script execution (DOMPurify strips it) |
| markdown with `<img onerror=alert(1)>` / `[x](javascript:alert(1))` | attribute / URL stripped |
| `/boards/:id` unknown | API 404 → not-found state, no crash |
| `/tasks/:id` unknown | API 404 → not-found state |
| project with no boards | overview empty state |
| board with no tasks | board-detail empty state |
| task with no comments / events | tab empty states |
| API unreachable (server down mid-session) | error card, no white screen (error boundary) |
| deep link to `/tasks/:id` (fresh load) | server serves index.html → app routes client-side |

## 5. Test strategy

- **Sanitizer unit tests** (`ui/src/lib/markdown.test.ts`, run under the ui Vitest project or a jsdom env): `<script>`, `onerror`, `javascript:` URL → stripped; plain markdown → expected HTML.
- **Component smoke** (optional, light): a page renders with mocked `useResource` data + an empty state. (Keep minimal — the Playwright smoke is the real render proof.)
- **SPA fallback** (server, `static.test.ts`): unmatched GET → index.html; `/api/project` still JSON.
- **Playwright smoke** (`tests/smoke/ui.spec.ts`): `substrate init` + seed a board/task via MCP or fixture → `substrate serve` → visit `/`, `/boards`, `/tasks/:id` → assert mounted (a known element) + zero `console.error`. Runs via a `test:smoke:ui` script (not the default `pnpm test`).

## 6. Acceptance criteria

- Browser at `http://localhost:7475` shows the project overview, navigable to boards → board detail → task detail (description, comments, events).
- A page rendering markdown with `<script>` shows text without script execution (sanitizer test).
- Every page has an empty state.
- The Playwright smoke passes against a freshly-initialized + seeded substrate.
- Deep-linking to `/boards/:id` and `/tasks/:id` works (SPA fallback).
- `pnpm test`, `tsc` (root+ui), `eslint`, `prettier`, `pnpm build` (server + ui), concurrency smoke, manual MCP smoke all green.
- `BINARY_VERSION` → `0.0.6` (no schema change).

## 7. Recommended decisions — ALL CONFIRMED (Diego, 2026-06-03)

1. **`react-router-dom` (browser router) + a server SPA catch-all** in `static.ts` for working deep links. Recommend confirm.
2. **ShadCN components vendored as source** (Card/Badge/Tabs/Table + `cn()`), not via the ShadCN CLI — avoids Tailwind-v4 CLI friction. Recommend confirm.
3. **Hand-rolled typed fetch client + `useResource` hook** (no TanStack Query). Recommend confirm.
4. **`marked` + `dompurify`**, single `renderMarkdown` path, `<Markdown>` the only `dangerouslySetInnerHTML`. Recommend confirm.
5. **Playwright smoke runs via `test:smoke:ui`** (separate from `pnpm test`; CI wires it in Phase 6). Recommend confirm.
6. **Overview shows board cards without task counts** (deferred from 5a). Recommend confirm.

## 8. Definition of Done (for this spec)

Approved by Diego when §3.0 decisions stand and §7 recommendations are confirmed. Then per workflow.md Stage 2: Architect drafts the 5b plan → Architect Reviewer → revision → Diego approves → development.
