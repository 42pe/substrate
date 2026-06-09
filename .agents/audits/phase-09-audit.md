# Phase 9 Audit — Kanban inspector (board view as columns + live polling) → v0.3.0

**Auditor:** Assistant
**Date:** 2026-06-09
**Branch:** `feature/phase-09-kanban-inspector` (from `main`)
**Spec:** [`../plans/specs/phase-09-kanban-inspector-spec.md`](../plans/specs/phase-09-kanban-inspector-spec.md) (APPROVED — B1–B3 + C1–C8)
**Plan:** [`../plans/phase-09-kanban-inspector.md`](../plans/phase-09-kanban-inspector.md) (Reviewed v1.1)
**Verdict:** **PASS — go for fast-forward merge to `main` + tag `phase-09-complete`** (live publish + the real version-tag push remain operator-gated).

---

## What shipped

A UI + one read-only HTTP endpoint, no schema change, no MCP tool-surface change, no new dependency.

| Step | Deliverable | Commit |
|---|---|---|
| 1 | `GET /api/boards/:id/columns` aggregate (the project's first GROUP BY) — `countActiveTasksByGroup` + `listActiveGroupPreview` in the tasks repo, a group-list-driven handler in `src/http/routes/api/board-columns.ts` | `dd77360` |
| 2 | `getBoardColumns` client + visibility-aware `usePolling` hook | `2caf8a5` |
| 3 | Board detail kanban (default) + List toggle + `?view`/`?group` + demoted header + moved-card pulse + LiveIndicator | `a002063` |
| 4 | Overview multi-board kanban wall (per-board fan-out, error isolation) | `3a16e32` |
| 5 | Code Reviewer gate (prettier-only finding) | `1ccb871` |
| 6 | Version → 0.3.0, CHANGELOG/README, smoke extension, audit, merge | (this step) |

## Acceptance vs. spec

| Spec item | Status | Evidence |
|---|---|---|
| Columns endpoint: counts per active group, position order, `updated_at DESC` cards | ✅ | `board-columns.test.ts` (10 tests) |
| `limit`: non-int/neg → 400; huge → CLAMP (unlike `page_size`) | ✅ | endpoint tests assert 400 on `-5`/`abc`, 200+capped on `99999999` |
| Archived group → no column; archived task / task-in-archived-or-unknown-group → omitted | ✅ | group-list-driven join; tests `t4`/`t5`/`t6` |
| Board not found → 404; archived board still served; read-fresh | ✅ | endpoint tests |
| HTTP-only, NOT an MCP tool; 29-tool surface + whoami identity unchanged | ✅ | `getBoardColumns` has zero refs under `src/mcp/`; registry/whoami untouched |
| `usePolling`: first-load-only loading; in-place ticks; visibility pause/resume; reconnecting on bg failure; cleanup | ✅ | `usePolling.test.ts` (6 tests, fake timers + mocked Page Visibility) |
| Board detail: kanban default + List toggle via `?view`; `+N more` → `?view=list&group=`; List seeds `in_groups` from `?group`; collapsed details | ✅ | `BoardDetail.test.tsx` (5 tests) + Playwright |
| Moved-card diff: consumer-side; empty on first snapshot; exact id on move/new | ✅ | `Kanban.test.tsx` (3 tests) |
| Overview wall: one strip per non-archived board; counts + capped preview + `+N more`; per-board error isolation | ✅ | `Overview.test.tsx` (4 tests) + Playwright |
| Read-only contract (no DnD, GET-only, ApiDeps omits `root`) | ✅ | Code Reviewer confirmed; no mutation anywhere |
| Scroll axes (board detail 2 / overview 2, mini-cols don't scroll) | ✅ | `max-h-[calc(...)]` column + `overflow-x` row; mini-cols capped, no overflow-y |
| Pulse keyframe in `styles.css`, no new dep | ✅ | `card-pulse` present in built CSS (5×); deps diff empty |
| Version → next minor (0.3.0) via 4 sources + 1 guard; schema stays 2 | ✅ | version.ts/package.json/ui package.json/whoami all 0.3.0; whoami guard green |

## Gate results (all run first-hand this session)

- **Server suite (unit+integration): 483 passing** (+10 over the pre-phase 473 — the new columns endpoint tests). Includes the whoami lockstep guard at 0.3.0.
- **UI suite: 26 passing** (+10 over the pre-phase 16 — usePolling 6, Kanban 3, BoardDetail 5, Overview +2; one pre-existing Overview test rewritten).
- **Playwright UI smoke: 4/4** against the **real built stack** — overview wall (column + card + live indicator), `/boards` list, board-detail kanban + collapsed-details expand + **List toggle renders a `<table>`**, task detail.
- **Concurrency smoke:** 1 passing (60s).
- **tsc** (root build + ui), **eslint** (root + ui), **prettier --check .**: clean.
- **Build** (server + ui): clean; UI 0.3.0.
- **`pnpm publish --dry-run`:** name `@diegoferreyra/substrate`, **version 0.3.0**, 95 files — only `dist/**` + README/LICENSE/CHANGELOG + package.json (includes `dist/server/http/routes/api/board-columns.js`); no source/test leakage. **Dependencies unchanged** (root + ui diff empty but for version lines).

## Code Reviewer gate

One consolidated pass (Step 5) returned **APPROVE-WITH-CHANGES** with **no blockers** — the sole finding (C1) was prettier drift in the new files, fixed in `1ccb871`. The reviewer independently confirmed: read-only/MCP-surface intact, SQL parameterized + correct (count + per-group preview, `archived_at IS NULL` on both, `rowToTask` reused), `limit` validation, `usePolling` doesn't regress `useResource` and cleans up, `?view`/`?group` wiring, moved-card diff, scroll axes, no new dep, no markdown-sanitization regression.

## Scope deviations from spec

1. **`getBoardColumns` co-located in `tasks.ts`** (reusing the module-private `rowToTask`) rather than a separate `board-columns.ts` reads module — the plan offered both (N1) and recommended co-location to avoid exporting `rowToTask`. The HTTP **handler** (loadSubstrate + join + Zod shape) lives in `src/http/routes/api/board-columns.ts`. **In-spec.**
2. **No board-view `limit` constant on the UI side** — the board kanban calls `getBoardColumns(boardId)` with no `limit`, letting the server default to `KANBAN_COLUMN_LIMIT` (100). Avoids duplicating the 100 in the UI; the server clamps regardless. The Overview passes `OVERVIEW_PREVIEW_LIMIT = 4`. **Improvement, in-spec.**

## Residual risks / deferrals (flagged, not fixed)

1. **R1 — Overview fan-out cost.** Each poll tick re-reads the whole substrate-as-code once per board (`loadSubstrate` × B) plus the count/preview SQL. Bounded by board count, fine on localhost; the single `/api/overview` aggregate is the documented future optimization (spec §2 non-goal, §3.5 C5). **Accepted for v1.**
2. **R2 — Hidden-tab first load still fires one fetch.** On mount/deps-change `usePolling` runs once before checking `document.hidden`, then pauses the interval. Benign (a single request, data loads even in a backgrounded tab; no loop). Reviewer N1. **Accepted (arguably desirable).**
3. **R3 — Moved-card "newly present" also pulses tasks that scroll into the capped preview** (not only true new/moved tasks). Cosmetic, localhost-only, ≤1.5s. **Accepted.**
4. **R4 — UI bundle ~421 KB single chunk** (carried from 5b/6/7; +~2 KB this phase). No code-splitting, no CI bundle budget. **Accepted for v1.**
5. **R5 — CI has not run on this branch.** `feature/phase-09-kanban-inspector` is unpushed; the three workflows are unchanged this phase and ran green on prior phases, but the Phase 9 diff has never been CI-exercised (incl. the windows-latest leg). **Operator step.**
6. **R6 — Version coordination.** Phase 9 takes **0.3.0** (next minor above shipped 0.2.1, and the first of the three unbuilt phases to land). The **7b (error-logging)** and **8 (shareable-templates)** specs still say `0.3.0` while unbuilt — when either is built it must take the next available minor (0.4.0+) and update its own 4 sources. **Flagged for whoever builds those next.**
7. **R7 — OPERATOR-ONLY boundary (unchanged).** The agent stops at `phase-09-complete`. Live `npm publish`, the real `v0.3.0` tag push (fires `publish.yml`), and the `NPM_TOKEN` secret are Diego's. This phase ships in-repo + dry-run-verified. **By design.**

## Verdict

**PASS.** Phase 9 meets every spec acceptance criterion, both review gates (Architect spec/plan + one consolidated Code Reviewer) are satisfied with the Code Reviewer's single finding fixed in a real commit, and every locally-runnable gate passes first-hand: server 483 + UI 26 + Playwright 4 + concurrency 1, root+ui tsc/eslint/prettier clean, build clean, publish dry-run whitelist-exact at 0.3.0 with dependencies unchanged. The read-only contract and the 29-tool MCP surface are provably untouched; the new endpoint is the project's first aggregate query and is correct and well-tested; the kanban, the multi-board wall, and visibility-aware polling all behave per spec, with the moved-card highlight reflecting agents' MCP moves within a poll. Residuals are process/cosmetic (CI not yet run; version coordination for the still-unbuilt 7b/8; fan-out cost; minor pulse over-trigger) — none block the merge.

Recommended next actions (Orchestrator):
1. Fast-forward merge to `main`, tag `phase-09-complete`. **Do NOT push the `v0.3.0` tag or publish — operator triggers (R7).**
2. **Operator (Diego):** push the branch → confirm CI green on the real PR (first CI exercise of the Phase 9 diff, incl. the Windows leg) → review `pnpm publish --dry-run` for the 0.3.0 tarball → push the real `v0.3.0` tag to fire `publish.yml`.
3. When building 7b or 8 next, renumber them off 0.3.0 (R6).
