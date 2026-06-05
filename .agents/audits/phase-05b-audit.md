# Phase 5b Audit — React Read-Only Inspector UI

**Date:** 2026-06-05
**Auditor:** Assistant agent (separate from authors and reviewers)
**Branch:** `feature/phase-05b-react-ui`
**HEAD:** `e551e79` — `chore(phase-05b): acceptance pass + 0.0.6 (Step 5)`
**Commits this phase produced:** 5 on top of `main` (tag `phase-05a-complete`), plus the spec/plan doc commit.

## Summary table

| Category | Status |
|---|---|
| Stage 1 — Spec | DONE (APPROVED Diego 2026-06-03; §3.0 decisions locked; §7 recommendations all confirmed) |
| Stage 2 — Planning | DONE (Architect Reviewer v1.1, approve-with-changes, 1 BLOCKER B1 resolved; B1/C1–C7/N3/N5 incorporated) |
| Stage 3 — Development | DONE — Steps 1–3 committed; lint/format/types/build all clean |
| Stage 4 — QA | DONE — 412 server unit+integration green; 10 ui (jsdom) green; 4 Playwright smoke green |
| Stage 5 — Phase-end | DONE with notes (accepted residuals: 413 KB single-chunk bundle, no code-splitting; sanitizer now load-bearing and locked) |

## Hard gates compliance (workflow.md §"Hard Gates")

| # | Gate | Evidence |
|---|---|---|
| 1 | No plan without an approved spec | `.agents/plans/specs/phase-05b-spec.md` — `Status: APPROVED (Diego, 2026-06-03)`. |
| 2 | No development without an approved plan | `.agents/plans/phase-05b-react-ui.md` — `Status: Reviewed v1.1 … ready for development`. |
| 3 | No commits without code review | **Concrete in-repo artifact this phase:** `94a5e2f fix(review): address Phase 5b Code Reviewer findings (Step 4)`. The review found **no BLOCKERs/CONCERNs**; the commit applies two optional NITs (drop dead `getComment()` export; tighten the `dangerouslySetInnerHTML` ban from a per-file rule-off to an inline `eslint-disable-next-line`). Unlike Phase 5a — where the conditional fix commit was absent — Gate 3 here has a real audit-trail commit. |
| 4 | No PR without Assistant audit | This document, written by an agent separate from the authors. |

All four hard gates are satisfied. Gate 3 is the strongest of the recent phases (5a left no commit; this phase has a substantive `fix(review)`).

## Commit list (`main..HEAD`)

```
e551e79 chore(phase-05b): acceptance pass + 0.0.6 (Step 5)
94a5e2f fix(review): address Phase 5b Code Reviewer findings (Step 4)
16bbd76 test(ui): Playwright smoke over the served app (Step 3)
f1d1668 feat(ui): overview, boards, board-detail, task-detail pages (Step 2)
dc8a21a feat(ui): scaffolding + sanitizer mini-gate, API client, components, SPA fallback (Step 1)
1a59c1f docs: Phase 5b spec (approved) + plan (reviewed, ready for development)
```

Maps 1:1 to the plan's 5-step choreography: Step 1 (`dc8a21a`), Step 2 (`f1d1668`), Step 3 (`16bbd76`), the Step 4 Code Reviewer gate (`94a5e2f`), and Step 5 acceptance + `0.0.6` (`e551e79`). This audit doc lands separately as the planned `docs(phase-05b): assistant audit`. **No deviation in commit choreography** — every planned commit (including the conditional `fix(review)`) is present. Working tree is clean at `e551e79`.

## Spec §6 acceptance criteria

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | Browser shows the overview, navigable boards → board detail → task detail (description, comments, events) | PASS | 4 routes wired in `ui/src/main.tsx` (`/`, `boards`, `boards/:id`, `tasks/:id`) under a root `Layout`. `TaskDetail.tsx` renders description via `<Markdown>` and a `Tabs` Details/Comments/Events (`CommentsTab` line ~105, `EventsTab` line ~147). Playwright smoke navigates all four and asserts known elements + a sanitized comment body. |
| 2 | A page rendering markdown with `<script>` shows text without script execution | PASS | `ui/src/lib/markdown.test.ts`: "strips `<script>`", "strips event-handler attributes (onerror)", "strips javascript: URLs", "strips data: URLs in links", plus POSITIVE survival (`**bold**`/`` `code` ``/`[link]`/`- list`). 10 ui tests green. The Playwright task-detail test also asserts a `<strong>` renders (live render path), not raw HTML. |
| 3 | Every page has an empty state | PASS | `grep EmptyState ui/src/routes/` → all four routes (`Overview`, `Boards`, `BoardDetail`, `TaskDetail`) compose the shared `EmptyState` from `States.tsx`, which also provides `Loading`/`ErrorCard`/`NotFound`. |
| 4 | Playwright smoke passes against a freshly-initialized + seeded substrate | PASS | `pnpm test:smoke:ui` → `build:ui` then `playwright test`: **4 passed (2.2s)**. `ui-seed-and-serve.ts` does `init` → board file → 2 tasks → comment → event → `serve`; `ui.spec.ts` drives real Chromium over `/`, `/boards`, `/boards/:id`, `/tasks/:id` and asserts zero console/page errors. |
| 5 | Deep-linking to `/boards/:id` and `/tasks/:id` works (SPA fallback) | PASS | `static.ts` `app.get('*')` serves `index.html` for any non-`/api` GET (registered LAST). Locked by `api.test.ts` ("a client deep-link (/boards/x) falls through to the SPA index.html" → 200 `text/html`) and `static.test.ts` ("SPA fallback: unmatched non-/api GET serves index.html"). The smoke loads `/boards/main` and `/tasks/t1` directly. |
| 6 | `pnpm test`, `tsc` (root+ui), `eslint` (+ ui lint), `prettier`, `pnpm build` (server+ui), concurrency smoke, manual MCP smoke all green | PASS (with notes) | See Test results. **412 server tests, 54 files, 0 failures; 10 ui tests, 3 files, 0 failures.** All static gates exit 0. Concurrency + manual MCP smoke not re-executed in this audit (accepted on instruction they ran green this session). |
| 7 | `BINARY_VERSION` → `0.0.6` (no schema change) | PASS | `src/core/version.ts`: `BINARY_VERSION = '0.0.6'`; root `package.json` version `0.0.6`; `BINARY_SCHEMA_VERSION = 2` (unchanged — no migration). `npm pack --dry-run` → `diegoferreyra-substrate-0.0.6.tgz`, 85 files. |

## Sanitizer / security review (R-P5-3 — the headline risk)

The single sanitized markdown→HTML path is the security-critical surface for this phase. Independently verified:

- **Exactly one `dangerouslySetInnerHTML` in `ui/src`.** `grep -rn dangerouslySetInnerHTML ui/src/` returns one *functional* hit — `Markdown.tsx:15` — the other three hits are comments documenting the invariant. `grep -rn innerHTML ui/src/` → no other hits. `Markdown.tsx` is the sole injection site and it renders only `renderMarkdown(source)`.
- **DOMPurify is the gate, marked stays at defaults.** `markdown.ts`: `DOMPurify.sanitize(marked.parse(src, { async: false }), { USE_PROFILES: { html: true } })`. The header comment explicitly forbids "simplifying" the sanitize away or enabling an HTML-emitting marked extension. The strip suite proves `<script>`, `onerror`, `javascript:` and `data:` URLs are removed; the positive-survival test proves bold/code/link/list are NOT over-stripped.
- **No author string bypasses `<Markdown>`.** Every author-supplied string reaches the DOM through `<Markdown>`: `board.description` and `policy.description` (`BoardDetail.tsx:37,89`), `task.description` and comment `body` (`TaskDetail.tsx:62,128`), `project.description` (`Overview.tsx`). `custom_data` key/values render as plain React text (auto-escaped), not HTML. Policy/group/board *names* and agent names render as plain text. No `description`/`body`/`message` is rendered with a raw `dangerouslySetInnerHTML`.
- **The lint rule is ON for `Markdown.tsx` (post-Step-4 fix).** `ui/eslint.config.js` bans `JSXAttribute[name.name="dangerouslySetInnerHTML"]` via `no-restricted-syntax` with **no** per-file override (the Step-4 fix removed the old `files: ['src/components/Markdown.tsx'] → rule: off` block). The single allowed line carries an inline `eslint-disable-next-line`. **Independently confirmed a second usage is still flagged:** I temporarily added a second `dangerouslySetInnerHTML` to `Markdown.tsx`, ran `eslint`, and got `error … dangerouslySetInnerHTML is banned … no-restricted-syntax` (exit 1), then restored the file. The invariant is genuinely CI-enforced, not just inline-disabled.
- **Reads-only invariant (server + client).** `ui/src` makes exactly one `fetch` (`api.ts:71`) with no `method` option → GET only; `grep` for `method: 'POST'|'PUT'|'PATCH'|'DELETE'` in `ui/src` → none. The real guarantee is server-side: `/api` registers `app.get` only and `POST /api/boards → 404` is asserted (`api.test.ts:222`). The SPA catch-all **404s unknown `/api/*` instead of serving HTML** — `static.ts:115` guards `if (c.req.path.startsWith('/api/')) return c.notFound()`, locked by both `api.test.ts` ("an UNKNOWN /api/* path returns 404, NOT the SPA HTML") and `static.test.ts` ("an unknown /api/* GET is NOT served the SPA (404, not HTML)"). A typo'd API path can never silently return an HTML 200.

The sanitizer deferral tracked across Phases 2/3/4/5a audits is now **closed**: 5b is where the author strings finally render as HTML, and they render exclusively through the DOMPurify gate, with the invariant lint-enforced and grep-verified.

## Spot-checked correctness claims

- **API client checks `res.ok` and throws a typed error.** `apiGet` (`api.ts:70–82`) throws `ApiError(status, body)` carrying the parsed `{ error: { code, message } }` on any non-2xx; `useResource`/`usePaginated` surface it as an `ErrorCard`. Query params are `encodeURIComponent`-escaped (`qs`, line 62–68).
- **SPA catch-all ordered after `/api` and `/assets`.** `registerStaticFallback` registers `/` and `/assets/*` then `app.get('*')` last; `createApp` mounts `/api` before the static fallback (carried from 5a, where `api.test.ts` locks `/api/project` → JSON not HTML). No route shadowing.
- **Pagination is cursor-based "Load more", no infinite scroll.** `usePaginated.ts` resets on `deps` change with a token guard (cancel-on-unmount / stale-response drop via `tokenRef`), appends on `loadMore()` using `next_cursor`. Comments and events use the API default page size (no explicit `page_size`), matching spec §3.4.
- **Error boundary present.** `main.tsx` sets `errorElement: <RouteError />` on the root route; per-route `Loading`/`ErrorCard`/`NotFound` states from `States.tsx`. A 404 from the API surfaces as an `ErrorCard`/not-found, no white screen.
- **Build isolation holds (C7).** `grep -rn "from 'react'|from 'marked'|from 'dompurify'" dist/server/` → no matches. The UI bundles `@core` types via `import type` only, so nothing server-side ships react/marked/dompurify.
- **Vendored ShadCN-style components, not via CLI.** `ui/src/components/ui/` has `Card`, `Badge`, `Tabs` (Radix `@radix-ui/react-tabs`), `Table`, plus `lib/cn.ts` — source-vendored as specified, avoiding the Tailwind-v4 CLI friction (R-P5-1).
- **Dependency pins match the plan.** `marked` 18.0.5 (≥9, honors `{ async: false }`), `dompurify` 3.4.8 (v3), `tailwind-merge` 3.6.0 (≥2), `@testing-library/react` 16.3.2 + `@testing-library/dom` 10.4.1, `react-router-dom` 7.17.0.

## Test results

| Suite | Files | Tests | Result |
|---|---|---|---|
| `pnpm test` (server unit + integration, node) | 54 | **412** passed | green (17.9 s) |
| `pnpm --dir ui test` (jsdom: sanitizer + components) | 3 | **10** passed | green (1.2 s) |
| `pnpm test:smoke:ui` (Playwright, builds ui first) | 1 | **4** passed | green (2.2 s) |
| `pnpm exec tsc --noEmit` (root) | — | — | clean (exit 0) |
| `pnpm --dir ui exec tsc --noEmit` | — | — | clean (exit 0) |
| `pnpm exec eslint .` (root) | — | — | clean (exit 0) |
| `pnpm --dir ui exec eslint .` | — | — | clean (exit 0) |
| `pnpm exec prettier --check .` | — | — | clean ("All matched files use Prettier code style!") |
| `pnpm build` (server + ui) | — | — | clean (ui 413.35 KB JS / 15.55 KB CSS, exit 0) |
| `npm pack --dry-run` | — | — | `diegoferreyra-substrate-0.0.6.tgz`, 85 files, exit 0 |
| `pnpm test:smoke:concurrency` | — | — | run separately this session, passing (not re-executed in this audit) |
| Manual MCP smoke (`run-smoke.mjs`) | — | — | run separately this session, passing (not re-executed in this audit) |

**412 server passing** — +4 over Phase 5a's 408 (the new `api.test.ts` deep-link + unknown-`/api` cases and extended `static.test.ts`). The 10 ui tests (markdown sanitizer suite + `Overview.test.tsx` empty state + `TaskDetail.test.tsx` Markdown-render) run under `ui/`'s own jsdom Vitest, separate from the node-only root runner, as planned.

## Coverage notes (tested vs. gaps)

**Well covered.** The security surface is the most-tested part: a 6-case sanitizer suite (4 strip + 1 data-URL + 1 positive-survival + an import smoke), the lint guard (independently confirmed to flag a second usage), and an end-to-end Playwright assertion that markdown renders as real `<strong>` through the live API. The SPA fallback is locked from two angles (`api.test.ts` createApp-level + `static.test.ts` unit). The reads-only guarantee is server-enforced (`POST → 404`) and grep-confirmed client-side.

**Gaps / thin spots (none blocking):**

1. **UI component tests are minimal by design.** Only two route component tests (`Overview.test.tsx` empty state, `TaskDetail.test.tsx` Markdown render). `Boards.tsx`, `BoardDetail.tsx`, the filter controls (group/archived/text_search), and the "Load more" pagination have **no isolated jsdom test** — they are covered only transitively by the 4-route Playwright smoke (happy path against one seeded fixture). The spec explicitly scoped component tests as "minimal — Playwright is the real proof" (§5), so this is per-plan, but the filter/pagination logic in `usePaginated.ts` and `BoardDetail`'s `TaskTable` is exercised only at the integration level, not unit-tested against edge inputs (e.g. empty filter result, multi-page "Load more").
2. **Playwright smoke is single-fixture, single-browser, happy-path.** It proves the four routes mount with no console errors against one seeded substrate in Chromium. It does **not** assert the empty states, the not-found (404) states, the API-error card, or deep-linking to an *unknown* board/task in the browser. Those states exist in code and have unit/static backing, but the live render of the not-found / error paths is unobserved.
3. **Concurrency + manual MCP smoke not re-executed in this audit** — accepted on instruction that both ran green this session. This audit did not independently observe them.
4. **Comments/events pagination defaults are implicit.** `CommentsTab`/`EventsTab` pass no `page_size`, relying on the API default. Correct, but the "Load more" multi-page path is not exercised by any test (the seed has one comment, one event) — only the single-page render is proven.

## Scope deviations from spec

1. **`getComment()` UI client wrapper removed (NIT 1, Step 4).** The spec §3.3 listed `getComment(id)` among the typed wrappers; the Code Reviewer found it was never wired (the comments tab uses `getComments`) and removed it as dead code. The **server** `/api/comments/:id` route remains (`index.ts:118`). **Accepted / intentional cleanup.**
2. **Single-chunk bundle, no code-splitting.** The build emits one 413.35 KB JS asset (130.75 KB gzip) — no route-level lazy-loading. The spec/plan did not require code-splitting for a 4-page local inspector, but the bundle is ~2.1× the Phase 1 shell (192 KB) after adding react-router, marked, dompurify, and Radix. **Accepted for v1; flagged as a residual** (see below).
3. **Spec §3.6 wording "policy `message`"** — the `Policy` type carries `name`/`description`, not a `message` field. `policy.description` is the author string and it routes through `<Markdown>`; `policy.name` renders as plain text. No functional gap; the spec's "`message`" is a naming slip, not a missed surface. **Noted, non-blocking.**

## Residual risks / deferrals

1. **R1 — bundle size / no code-splitting.** 413 KB single chunk (131 KB gzip). Fine for a localhost-only inspector loaded once, but there is no lazy route loading and no bundle budget in CI. **Accepted for v1; candidate for Phase 6** (CI wiring + a size budget).
2. **R2 — Playwright not in CI yet.** `test:smoke:ui` runs via a separate script and is **not** part of `pnpm test`; the spec/plan scope CI wiring (and the browser download) to Phase 6. Until then the smoke only runs on demand. **Accepted / intentional (§3.0 decision 2, plan R5).**
3. **R3 — component/edge coverage is thin** (coverage gaps 1–2). Filters, multi-page "Load more", and the live not-found/error states lean on the single-fixture Playwright happy path. Low risk for a read-only inspector; a follow-up could add jsdom tests for the filter/pagination reducer and a browser assertion on an unknown-id deep link. **Accepted; non-blocking.**
4. **R4 — SPA catch-all is load-bearing now.** The `/api`-before-`*` ordering (defensive in 5a) is live this phase; the `/api/` exclusion guard in `static.ts:115` is the thing standing between a typo'd API path and an HTML 200. Double-tested (`api.test.ts` + `static.test.ts`). **Accepted; keep both tests as regression anchors.**
5. **R5 — `@core` type-only import across the package boundary.** The UI imports `src/core/types.ts` via the `@core` Vite/tsconfig alias as `import type` only, so nothing server-side leaks into the bundle (C7-verified). If a future UI edit imports a *value* from `@core`, the build-isolation grep would catch it only if re-run. **Accepted; the `import type` discipline is the guardrail — keep the C7 grep in the acceptance gate.**
6. **R6 — localhost-only, no auth.** Inherited from Phase 1 (origin/Host allowlist + 127.0.0.1 bind). The UI is same-origin and adds no new server security surface beyond the SPA catch-all (still behind the allowlist). **Accepted / intentional for v1.**

## Verdict

**PASS-WITH-NOTES — go for fast-forward merge to `main` + tag `phase-05b-complete`.**

Phase 5b substantively meets every spec §6 acceptance criterion. All locally-run gates are clean: **412 server tests + 10 ui tests + 4 Playwright smoke green** (0 failures), root + ui `tsc` clean, root + ui `eslint` clean, prettier clean, build clean, `npm pack --dry-run` clean. `BINARY_VERSION` is `0.0.6`, `package.json` is `0.0.6`, `BINARY_SCHEMA_VERSION` stays `2` (no migration). All four workflow hard gates are satisfied — and Gate 3 has a **real `fix(review)` commit** (`94a5e2f`) this phase, a stronger audit trail than Phase 5a's conditional (absent) commit.

The headline risk — sanitizer bypass (R-P5-3) — is independently verified closed: exactly one functional `dangerouslySetInnerHTML` in `ui/src` (the rest are comments), DOMPurify is the sole sufficient gate (strip + positive-survival tested), every author string (`description`/`body`) routes through `<Markdown>`, the ban is CI-enforced with the rule ON for `Markdown.tsx` (I confirmed first-hand that a second usage is flagged), and the reads-only invariant holds both client-side (single GET-only fetch, no write methods) and server-side (`POST → 404`; unknown `/api/*` → 404 not HTML, double-tested). The long-deferred markdown sanitizer is finally landed and locked.

The notes are coverage breadth, not correctness: UI component tests are deliberately minimal (filters, multi-page "Load more", and the live not-found/error states lean on a single-fixture happy-path Playwright run), the 413 KB single-chunk bundle has no code-splitting or CI size budget, and Playwright is not yet in CI (Phase 6 scope). None block the merge; all are consistent with the spec's locked "ship it fast, read-only inspector" decisions. Concurrency and manual MCP smoke were run separately this session and pass; this audit did not re-execute them.

Recommended next actions (Orchestrator):
1. Merge fast-forward to `main`, tag `phase-05b-complete`.
2. **Carry into Phase 6:** wire `test:smoke:ui` into CI (browser download), add a bundle-size budget / consider route-level code-splitting, and add a couple of jsdom tests for the filter/pagination reducer + a browser assertion on an unknown-id deep link (not-found render).
3. Flip plan status to `Complete`.
