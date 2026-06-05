# Phase 5b Plan — React Read-Only UI

**Status:** Reviewed v1.1 (Architect Reviewer: approve-with-changes; 1 BLOCKER resolved) — ready for development
**Author:** Architect (revised after review)
**Last updated:** 2026-06-03
**Review notes:** Incorporated B1 (add a `ui/` ESLint config + a lint rule banning `dangerouslySetInnerHTML` outside `Markdown.tsx`, wire `pnpm --dir ui lint` into the gate — turns R-P5-3's invariant from convention into CI), C1 (a marked→DOMPurify jsdom smoke is the FIRST Step-1 task; pin `marked` ≥9 + `dompurify` v3), C2 (DOMPurify-alone is the documented single gate; add a positive-survival test that links/code/lists survive), C3+C4 (the SPA catch-all must NOT serve index.html for unknown `/api/*` — it returns 404; add a `createApp`-based deep-link + unknown-`/api` test), C5 (`pnpm build` is a stated precondition of `test:smoke:ui`), C6 (`@core` alias wired into `ui/vitest.config.ts` too), C7 (build-isolation grep: `dist/server` has no react/marked/dompurify), N3/N5 (pin `tailwind-merge` v2+, `@testing-library/react` v16 + `@testing-library/dom`; resolve the dangling dark-mode variant in styles.css). **Per the reviewer's Q7 recommendation, Step 1 ends with a sanitizer mini-gate** (jsdom smoke + full strip/survival suite + the lint guard) so the security surface is locked before any page builds on it.
**Spec:** [`specs/phase-05b-spec.md`](specs/phase-05b-spec.md) (APPROVED 2026-06-03)
**Architecture plan:** [`v1-architecture.md`](v1-architecture.md) §5 Phase 5
**Workflow:** [`../workflow.md`](../workflow.md)
**Feature branch:** `feature/phase-05b-react-ui`

---

## 1. Overview

Phase 5b builds the read-only inspector UI on the Phase 1 shell, consuming the 5a API. **Lighter stack:** `react-router-dom` + vendored ShadCN-style components + a hand-rolled typed fetch client + a single `marked`→`DOMPurify` markdown path. One Playwright smoke. The security-critical surface is the sanitizer.

**5 steps, one Code Reviewer gate** (Step 4) with a mandated sanitizer-bypass audit. No SQLite schema change; `BINARY_VERSION` → `0.0.6` at acceptance.

## 2. Branching & merge strategy

- Create `feature/phase-05b-react-ui` from `main` (tag `phase-05a-complete`).
- Commit per step. One Code Reviewer pass (Step 4).
- Fast-forward merge to `main`, tag `phase-05b-complete`.

## 3. Test/runner structure (important)

- The root `pnpm test` (`vitest --project=unit --project=integration`) is **node-only** and stays server-side. The UI's sanitizer + component tests need a DOM, so they run under **`ui/`'s own Vitest** (jsdom) via a new `ui/vitest.config.ts` + `ui/package.json` `test` script. The acceptance gate adds `pnpm --dir ui test`.
- The **Playwright** smoke runs via a root `test:smoke:ui` script (separate from `pnpm test`; CI wires it in Phase 6).
- `src/core/types.ts` is imported into the UI via a Vite + ui-tsconfig path alias `@core/*` → `../src/core/*` (the UI bundles types only; the server stays the source of truth).

## 4. Implementation order

### Step 1 — Scaffolding + the sanitizer mini-gate (Frontend Engineer)

**Do the sanitizer FIRST (C1):** before anything else, add `ui/vitest.config.ts` (jsdom), `marked` (pin ≥9, which honors `{ async: false }`), `dompurify` (v3), write `markdown.ts`, and a 10-line smoke proving `renderMarkdown('<script>x</script>')` *imports and runs* under jsdom — i.e. that DOMPurify is window-bound in the test env before any page depends on it. If it needs `createDOMPurify(window)` wiring, discover it now.

Create / modify:
- `ui/package.json` — deps: `react-router-dom`, `marked` (≥9), `dompurify` (v3); ShadCN companions `clsx`, `tailwind-merge` (≥2, understands Tailwind-v4 output), `class-variance-authority`, `@radix-ui/react-tabs`, `lucide-react`; dev: `vitest`, `jsdom`, `@testing-library/react` (≥16), `@testing-library/dom`, `eslint` + the TS/react plugins. Add `test` (vitest) and `lint` scripts.
- `ui/vitest.config.ts` (new) — `environment: 'jsdom'`; include `src/**/*.test.{ts,tsx}`; **`resolve.alias` for `@core` (C6)** (vitest doesn't read tsconfig paths) — or `extends` the Vite config.
- `ui/eslint.config.js` (new, **B1**) — flat config (`@typescript-eslint`, `eslint-plugin-react`, `react-hooks`) over `ui/tsconfig.json`; a `no-restricted-syntax`/`react/no-danger` rule that **bans `dangerouslySetInnerHTML` everywhere except `Markdown.tsx`** (one `eslint-disable` with a justification there). Either un-ignore `ui/**` in the root config or add `pnpm --dir ui lint` to the gate (Step 5).
- `ui/vite.config.ts` + `ui/tsconfig.json` — `@core/*` → `../src/core/*` alias (Vite `resolve.alias` + tsconfig `paths`/`baseUrl`; ensure `server.fs.allow` permits `..` if dev needs it). UI imports **types only** from `@core` (`import type`), so nothing is emitted into the bundle.
- `ui/src/lib/markdown.ts` — `renderMarkdown(src) = DOMPurify.sanitize(marked.parse(src,{async:false}) as string, { USE_PROFILES: { html: true } })`. **Header comment (C2): DOMPurify is the single, sufficient gate; marked stays at defaults (no HTML-emitting extensions); do not "simplify" the sanitize away.** `ui/src/components/Markdown.tsx` — the ONLY `dangerouslySetInnerHTML` in the app.
- `ui/src/lib/api.ts` — `apiGet<T>(path)` (checks `res.ok`, throws `ApiError` with the parsed error body); typed wrappers using `@core` types. `ui/src/lib/useResource.ts` — `{ data, error, loading }` hook (cancel-on-unmount).
- `ui/src/components/ui/` — vendored ShadCN-style `Card`, `Badge`, `Tabs` (Radix), `Table`, + `ui/src/lib/cn.ts`. Resolve the dangling dark-mode `@custom-variant` in `styles.css` (use or drop — N3).
- `src/http/routes/static.ts` — add a SPA fallback `app.get('*')` (registered LAST). **C3/C4: it MUST return 404 (not index.html) for any path starting `/api/` — guard `if (c.req.path.startsWith('/api/')) return c.notFound();` then serve `index.html` for everything else.** Keep `app.get('/')` for intent clarity (a one-line comment notes `*` would also cover it). `/api` registered-routes are matched before `*` anyway; this guard handles UNKNOWN `/api/*` paths so a typo'd API path returns 404, not HTML.

Tests (the Step-1 **sanitizer mini-gate** + ordering):
- `ui/src/lib/markdown.test.ts` — **thorough security suite:** `<script>alert(1)</script>` → no `<script>`; `<img onerror=...>` → no `onerror`; `[x](javascript:alert(1))` → no `javascript:`; `<a href=data:...>` stripped; **positive survival (C2): `**bold**`, `[link](https://x)`, `` `code` ``, `- list` render to `<strong>/<a href>/<code>/<ul>` and SURVIVE** (catches an over-stripping config regression). Plus the jsdom import smoke.
- `src/http/routes/api/api.test.ts` (createApp-based, **C3**) — deep-link GET `/boards/x` → `index.html` (`content-type: text/html`); **unknown `/api/nope` GET → NOT html (404), confirming the catch-all excludes `/api/`**; the existing `/api/project` → JSON assertion now genuinely locks ordering.
- `src/http/routes/static.test.ts` extend — unmatched non-`/api` GET → the (placeholder, build-free) index.html.

_Reviewer focus (Step 4):_ the sanitizer config + `<Markdown>`-only render path (now lint-enforced); the `/api/` exclusion in the catch-all; api client checks `res.ok`; no write call anywhere in the UI.

Commit: `feat(ui): scaffolding + sanitizer mini-gate, API client, components, SPA fallback (Step 1)`.

### Step 2 — Pages + routing (Frontend Engineer)

Create:
- `ui/src/main.tsx` — `createBrowserRouter` with the root layout + 4 routes; replace the Phase 1 shell.
- `ui/src/routes/Layout.tsx` — header/nav + `<Outlet/>` + a top-level error boundary.
- `ui/src/routes/Overview.tsx` (`/`) — project header (description via `<Markdown>`) + board cards → `/boards/:id`. Empty/error states.
- `ui/src/routes/Boards.tsx` (`/boards`) — board list + archived toggle.
- `ui/src/routes/BoardDetail.tsx` (`/boards/:id`) — board header; groups as `Badge`s; field_schema + policies summary; task `Table` with filters (group, archived, text_search) + "Load more"; rows → `/tasks/:id`. Not-found on 404.
- `ui/src/routes/TaskDetail.tsx` (`/tasks/:id`) — title; description via `<Markdown>`; custom_data; `Tabs` Details/Comments/Events. Comments thread (bodies via `<Markdown>`); event history. Empty states.
- A shared `<ErrorCard>` / `<EmptyState>` / `<Loading>`.

Tests:
- Light component tests (jsdom, mocked `useResource`): Overview empty state; TaskDetail renders a comment body through `<Markdown>` (not raw). Keep minimal — Playwright is the real proof.

_Reviewer focus:_ every author string (description, comment body, policy message) goes through `<Markdown>`; empty + error + not-found states on every page; no `dangerouslySetInnerHTML` outside `<Markdown>`.

Commit: `feat(ui): overview, boards, board-detail, task-detail pages (Step 2)`.

### Step 3 — Playwright smoke (Frontend Engineer)

- Add `@playwright/test` (dev) + `playwright install chromium` (documented; CI installs in Phase 6).
- `tests/smoke/ui.spec.ts` — in a temp dir: `substrate init` → seed a board + group + task (+ a comment) via the MCP tools or by authoring a board file + repo inserts → `substrate serve` on a free port → Playwright visits `/`, `/boards`, `/boards/:id`, `/tasks/:id`; asserts a known element mounts on each and collects `console.error` (must be empty). Tear down the server.
- Root `package.json` — `test:smoke:ui` script. **C5: it serves `dist/ui`, so `pnpm build` (or `build:ui`) MUST run first — make the script `pnpm build:ui && playwright test ...` (or document the precondition), else the smoke serves the placeholder and every assertion fails.** NOT part of `pnpm test`.

_Reviewer focus:_ the smoke actually renders against the real API (not mocked); console-error assertion; clean server teardown.

Commit: `test(ui): Playwright smoke over the served app (Step 3)`.

### Step 4 — 🛑 Code Reviewer pass (whole phase)

One Code Reviewer over `git diff main...HEAD`. **Mandated focus — sanitizer bypass (R-P5-3):**
- Is `renderMarkdown` the ONLY path to HTML, and `<Markdown>` the ONLY `dangerouslySetInnerHTML`? Grep the UI for `dangerouslySetInnerHTML` / `innerHTML` — only one hit allowed.
- DOMPurify config: does `USE_PROFILES: { html: true }` strip `<script>`, event handlers, and `javascript:`/`data:` URLs? Any config that re-enables them?
- Does any value reach the DOM as HTML without going through the sanitizer (e.g. a `description`/`body`/`message` rendered with `dangerouslySetInnerHTML` directly)?
Plus: SPA catch-all ordered after `/api` (no API shadowing); the UI makes only GET calls (reads-only — no fetch with a write method); error/empty/not-found states present; api client checks `res.ok`.

Fix BLOCKERs + CONCERNs in a `fix(review)` commit.

Commit: `fix(review): address Phase 5b Code Reviewer findings (Step 4)` (only if findings).

### Step 5 — Acceptance + audit + merge (Frontend Engineer → Assistant)

- Acceptance gate: `pnpm build` (server + ui), `pnpm test` (server), **`pnpm --dir ui test`** (sanitizer + components), `tsc` (root + ui), `eslint` + **`pnpm --dir ui lint`** (B1), `prettier`, `pnpm test:smoke:concurrency`, `node tests/manual/run-smoke.mjs`, **`pnpm test:smoke:ui`** (Playwright; build runs first per C5), `npm pack --dry-run` + **a build-isolation grep that `dist/server/` contains no `react`/`marked`/`dompurify` (C7)**. Bump `BINARY_VERSION` → `0.0.6`.
- Manually verify (or via the Playwright run): overview → boards → board detail → task detail; a `<script>` in a description renders as inert text.
- Spawn Assistant → `.agents/audits/phase-05b-audit.md`. Resolve gaps.
- Fast-forward merge to `main`, tag `phase-05b-complete`.

Commits: `chore(phase-05b): acceptance pass + 0.0.6 (Step 5)`, `docs(phase-05b): assistant audit (Step 5)`.

## 5. Test mapping (spec §5 → plan)

| Spec requirement | Plan location |
|---|---|
| sanitizer unit tests | Step 1 (`markdown.test.ts`) |
| SPA fallback + `/api` JSON | Step 1 (`static.test.ts`) |
| page render / empty states | Step 2 (component tests) + Step 3 (Playwright) |
| Playwright smoke | Step 3 |

## 6. Risks

- **R1 (sanitizer bypass — security):** the headline risk. Mitigation: single `renderMarkdown` path, `<Markdown>` the only `dangerouslySetInnerHTML`, thorough Step 1 tests, mandated Step 4 audit + grep.
- **R2 (Tailwind v4 + ShadCN friction, R-P5-1):** mitigated by vendoring component source (no ShadCN CLI) and reusing the existing `@tailwindcss/vite` setup. Budget conservatively in Step 1.
- **R3 (SPA fallback shadows `/api`):** mitigated by ordering — `/api` registers before the `*` catch-all (already true in `createApp`); a test locks `/api/project` → JSON.
- **R4 (UI test runner):** root vitest is node-only; UI tests run under `ui/`'s jsdom Vitest. Documented; acceptance runs `pnpm --dir ui test`.
- **R5 (Playwright in CI):** browser download is heavy; the smoke runs via a separate script now and is wired into CI in Phase 6 (the spec/arch plan already scope CI there).
- **R6 (reads-only UI):** the real guarantee is SERVER-side and already tested — the HTTP API registers zero non-GET routes, so even a stray UI `fetch(...,{method:'POST'})` 404s (`api.test.ts` asserts `POST /api/boards → 404`). The reviewer grep for non-GET fetches is a secondary belt.

## 7. Definition of Done

- All step commits on `feature/phase-05b-react-ui`.
- Single Code Reviewer pass done (sanitizer-bypass audit clean); BLOCKER/CONCERN findings resolved.
- Spec §6 acceptance criteria met.
- Assistant audit clean.
- Fast-forward merge to `main`, tag `phase-05b-complete`.
