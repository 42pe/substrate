# Phase 12 Plan — UX foundation (design system + a11y + interactivity scaffolding)

**Status:** Draft for Diego's review
**Author:** Architect (synthesizing the 4-lens UX review)
**Date:** 2026-06-29
**Source:** [ux-review-20260629.md](../ux-review-20260629.md) (visual · IA · a11y · frontend)
**Prerequisite for:** [Phase 13–15 interactivity](specs/interactive-ui-spec.md). This phase
runs **first** so interactivity lands on a tokenized, accessible base.

---

## 1. Overview

A four-lens review found the read-only inspector is clean and well-architected at the data
layer but **has no design-system foundation** (raw Tailwind utilities, no tokens, no dark
mode), **fails several WCAG 2.1 AA criteria** (no focus ring, low-contrast text + status
dots, `aria-live` spam, non-semantic kanban), and **lacks the primitives + mutation/status
scaffolding** the interactivity phases need. Phase 12 fixes the base and pre-builds that
scaffolding — **without adding any write behavior** (no HTTP writes, no policy changes; the
UI stays read-only at the end of this phase). It also improves the v1 inspector itself, so
it can ship before public launch as polish.

## 2. Branching & merge strategy
- Branch `feature/phase-12-ux-foundation` off `main`.
- Mostly UI-only (`ui/`), plus a markdown render decision. Step commits; one Code-Reviewer
  pass (a11y + design-system focus).
- CI green — **blocked until the GitHub Actions minutes/spending limit is resolved**
  (decisions.md "Windows CI" postscript). The Playwright/UI smoke must validate this phase.

## 3. Workstreams & implementation order

### Step 1 — Token layer + dark-mode structure — (Frontend) [ux §A]
- Add an `@theme` block + `:root`/`.dark` CSS-var pair in `ui/src/styles.css` with the
  ShadCN-standard set: `--background, --foreground, --card(-foreground), --popover(-fg),
  --muted(-foreground), --border, --input, --ring, --primary(-fg), --secondary(-fg),
  --destructive(-fg), --warning(-fg), --accent(-fg), --radius`.
- Enable `@custom-variant dark`; switch `ui/index.html` `<body>` to `bg-background
  text-foreground`. Wire a minimal theme toggle (or `prefers-color-scheme`) — toggle UI is
  optional, but the structure must exist.
- **Done when:** tokens defined; `<body>` token-driven; light+dark both render coherently.

### Step 2 — Refactor vendored primitives + dedup composites to tokens — (Frontend) [ux §A]
- Rewrite `Card`, `Badge`, `Tabs`, `Table`, `States` (Loading/Empty/Error/NotFound),
  `LiveIndicator`, `Layout` nav, `Kanban` to consume tokens (no raw `neutral-*`).
- Extract shared primitives to kill duplication: `PageHeader`, `SectionHeading`,
  `LoadMoreButton` (currently ×3), `SegmentedControl` (replaces the bespoke `ViewToggle`),
  and a shared `TaskCard` used by both `Kanban` and `Overview` MiniColumn (with density
  variants). Carry the `missing_required_fields` badge into the Overview card.
- **Done when:** `grep "neutral-"` in `ui/src` ≈ 0; the dup'd blocks come from one source.

### Step 3 — Accessibility floor — (Frontend/A11y) [ux §B]
- Global `:focus-visible` ring in `styles.css`; remove the bare `focus:outline-none`
  (`Tabs.tsx:32`). Add an `sr-only` utility + `<VisuallyHidden>`; gate pulses behind
  `prefers-reduced-motion`.
- Contrast: replace `neutral-400`-on-white text with `neutral-600`/`--muted-foreground`
  (≥4.5:1); status dots → `emerald-600`/`amber-600` + a shape/glyph difference (not
  color-only), keep text labels.
- Semantics: columns → `role="list"`/`<li>` with per-column `aria-label` + `sr-only` count
  units; heading structure on the Overview wall; labelled `<nav>` + a skip-link to `#main`;
  `aria-label` on the search input + group select; `tabindex=0` + label on `<pre>` JSON.
- Tame the live region: `aria-live` announces **state transitions only**, not the ticking
  timestamp.
- Raise primary touch targets toward 44px (toggle, nav, Load-more).
- **Done when:** keyboard-only nav has a visible ring throughout; an axe/Lighthouse a11y
  pass on all 5 routes has no AA contrast/focus/landmark violations; SR doesn't spam.

### Step 4 — Mutation / status / optimistic scaffolding (no writes yet) — (Frontend) [ux §C, readiness]
- `ui/src/lib/api.ts`: add `apiPost/apiPatch/apiDelete` mirroring `apiGet`'s `ApiError`
  handling (always send the `X-Substrate-Client: ui` header so the Phase 13 write-guard is
  satisfied from day one). No write endpoints are *called* yet — the transport just exists.
- `useMutation<TArgs,TRes>(fn)` → `{ mutate, isPending, error, reset }`.
- Expose `refetch()` from `usePolling` + `usePaginated`; add an optimistic `setData` updater
  guarded by a **generation counter** so a 4s poll tick can't clobber an in-flight update.
- App-level **announcer**: one polite `role="status"` + one assertive region mounted in
  `Layout`, with `useAnnounce()`. Vendor a `Toast`/`Toaster` (`sonner`) + `useToast`.
- **Done when:** a throwaway harness can call a mutation hook (against a read endpoint) and
  see pending/error states, an optimistic `setData` survives a poll tick, and an announce()
  reaches SR — all without any real write route.

### Step 5 — Canonical status/conflict channel + liveness coverage — (Frontend) [ux §C]
- Hoist one freshness indicator into the header (`Layout`), driven by a shared heartbeat, so
  Boards / Task detail / List view aren't silent snapshots. Escalate `reconnecting`/`paused`
  with dwell time ("last live 3m ago" / dim stale content).
- Persist a lightweight "recently changed" marker (extend `useMovedTasks`) + a board-level
  "N updates since you arrived" — the future home for optimistic/conflict state.
- **Done when:** every route shows trustworthy liveness; a simulated dropped connection
  escalates visibly.

### Step 6 — Wayfinding, view-state-in-URL, consistency — (Frontend) [ux §D]
- Fix the breadcrumb: `← {board.name}` (not the raw id); add a `Boards / Board / Task`
  breadcrumb.
- Move tab / disclosure / list-filter state into search params (`?tab=comments`, etc.) so
  deep-links and post-action redirects work.
- Unify date formatting via a `<RelativeTime title={absolute}>` helper (kill raw
  `toLocaleString`). Render Events `changes` as field-level diffs with a shared humanizer
  reused by Activity.
- **Done when:** linking to a task's Comments tab works; dates are uniform; history reads
  as diffs.

### Step 7 — Layout, responsive & markdown rendering — (Frontend) [ux §E]
- Responsive header (hide the tagline < sm, collapse nav), reflow check at 320px.
- Ground the page layout (columns fill height / tighten the empty-expanse feel).
- **Markdown line-break fix (folded-in dogfood bug):** `renderMarkdown` calls
  `marked.parse(src, { async: false })` at defaults, so a *single* `\n` is a soft break
  rendered as a space — agents' single-newline content flattens to a run-on block ("0 new
  lines"). Content is stored faithfully (verified: the real sample has 39 encoded newlines;
  the write schema is `z.string()` with no trim/normalize) — this is purely a render
  default. Fix: `marked.parse(src, { async: false, breaks: true })` (GFM line breaks → `<br>`,
  which DOMPurify still sees — the "single sanitize gate" invariant holds; not a raw-HTML
  extension). `ui/src/lib/markdown.ts`, one line.
- Markdown styling: add a tokenized `.markdown` style (or `@tailwindcss/typography`) so the
  `prose` no-op is fixed — needed before Phase 14 comment rendering.
- **Done when:** mobile header doesn't clip; single-newline descriptions render with line
  breaks; markdown is styled.

### Step 8 — Vendor remaining interactive primitives (built, not yet wired) — (Frontend) [ux §A]
- Vendor (ShadCN-style, CVA + `cn`, Radix where applicable): `Button`, `Input`, `Textarea`,
  `Label`, `Checkbox`, `Select`, `Dialog` (focus-trap), `DropdownMenu`, and a `Field`
  wrapper (label + `aria-describedby` hint/error). Add deps: `@radix-ui/react-dialog`,
  `react-dropdown-menu`, `react-select`, `react-label`, `react-checkbox`, `sonner`.
- These ship **unused** this phase (or used only to re-skin the existing read-only filter
  controls) — they exist so Phase 13 forms/dialogs have an accessible, tokenized home.
- **Done when:** primitives exist, are token-driven, keyboard-accessible, and Storybook-free
  smoke-rendered (a dev page or a render test).

### Step 9 — Review + acceptance + audit — (Reviewer → Assistant)
- Reviewer focus: AA compliance, token coverage, no behavior regression (still read-only),
  the markdown render path still single-sourced.
- `.agents/audits/phase-12-audit.md`; fast-forward merge; tag `phase-12-complete`.

## 4. Acceptance criteria
- **No semantic regression:** the UI is still read-only and every existing route + the
  Playwright smoke pass; markdown still renders only via `markdown.ts`.
- **Tokens:** `grep "neutral-"` in `ui/src` ≈ 0; light + dark both coherent.
- **A11y (AA):** automated axe/Lighthouse pass on all 5 routes shows no contrast (1.4.3),
  focus (2.4.7), name/role (4.1.2), or landmark violations; visible focus ring on every
  interactive element; live region announces transitions only.
- **Scaffolding present (unused):** `apiPost/apiPatch`, `useMutation`, `refetch()` +
  optimistic `setData`+generation guard, the announcer + toast, the header status channel,
  URL-addressable tabs/filters, and the vendored primitives all exist and are tested.
- **Consistency:** one date helper; shared PageHeader/TaskCard/LoadMore; breadcrumb shows
  board name; mobile header doesn't clip at 320–390px.
- `pnpm lint`, `pnpm format:check`, `tsc --noEmit`, UI unit + the Playwright smoke green.

## 5. Operator / Diego tasks
- Resolve the GitHub Actions minutes/spending block so CI/Playwright can validate.
- Confirm: dark-mode toggle desired now or `prefers-color-scheme` only? `@dnd-kit` + the new
  Radix/`sonner` deps OK? (spec §9 Q4).

## 6. Test mapping
- Token/primitive refactors → existing UI unit tests + new render tests per primitive.
- A11y → an automated axe pass wired into the UI test run (new); manual keyboard sweep.
- Scaffolding → unit tests for `useMutation`, `refetch`, the optimistic generation guard,
  `useAnnounce`.
- Smoke → existing `tests/smoke/ui.spec.ts` still green (no behavior change); add focus-ring
  + live-region assertions.

## 7. Risks
- **R-12-1:** Token migration touches ~30 files — risk of visual drift. Mitigation: migrate
  primitives first, then routes; screenshot-compare against the captured baselines.
- **R-12-2:** Scaffolding built without a consumer can rot/mis-fit Phase 13. Mitigation:
  validate each scaffold against a throwaway harness and keep Phase 13's spec in view.
- **R-12-3:** Dark mode expands the QA surface. Mitigation: if time-pressed, ship the token
  layer + `.dark` overrides but gate the toggle behind `prefers-color-scheme` only.
- **R-12-4:** `@tailwindcss/typography` changes markdown rendering visually. Mitigation:
  review against the sanitizer output; the single render path is unchanged.

## 8. Definition of Done
- All acceptance criteria met; Code-Reviewer BLOCKER/CONCERN resolved.
- The UI is tokenized, AA-clean, and carries the (unused) mutation/status/primitive
  scaffolding the interactivity phases consume — with **zero new write behavior**.
- Audit clean → `.agents/audits/phase-12-audit.md`; fast-forward merge to `main`; tag
  `phase-12-complete`.
