# Phase 15 Plan — Column & board authoring (substrate-as-code via UI)

**Status:** Draft for Diego's review (builds on Phases 12–13)
**Author:** Architect
**Date:** 2026-06-29
**Spec:** [interactive-ui-spec.md](specs/interactive-ui-spec.md) (umbrella)
**Depends on:** [Phase 13](phase-13-interactive-write-foundation.md) foundation.
**Theme:** Let a human shape the board's **structure** — columns, the board itself,
the project — from the browser. These edits write **substrate-as-code** (`boards/*.json`),
not just SQLite.

---

## 1. Overview

Tasks and comments live in SQLite (gitignored). **Structure** — groups (columns),
boards, project metadata, `field_schema`, policies — lives in committed
`boards/*.json` and `config.json`, edited through the substrate **writer**
(`mutateBoardFile`, board-level version CAS). Phase 15 exposes the safe subset of
that authoring to the UI: **columns and board/project metadata**. Policy and
`field_schema` *editing* is explicitly **deferred to Phase 16** (see spec §5).

The defining concern (D9): these edits change **git-tracked files**, so the UI must
signal "this edits source you'll want to commit."

## 2. Branching
- Branch `feature/phase-15-column-board-authoring` off `main`.
- Step commits; one Code-Reviewer pass; CI green (Actions billing must be live).

## 3. Implementation order

### Step 1 — Group/board/project operations — (Backend)
- Extract substrate-edit ops into `src/operations/` (closure pattern over
  `mutateBoardFile`, `writer.ts:120`; board-level version CAS via `assertVersion`):
  - groups: `applyCreateGroup`, `applyUpdateGroup` (name/description/color),
    `applyReorderGroups` (permutation-validated, `reorder-groups.ts:30`),
    `applyArchiveGroup` (rejects `conflict` if active tasks reference it),
    `applyUnarchiveGroup`
  - board: `applyCreateBoard`, `applyUpdateBoard` (name/description),
    `applyArchiveBoard` / `applyUnarchiveBoard`
  - project: `applyUpdateProject` (name/description in `config.json`)
- **Done when:** ops extracted; MCP substrate-edit tests pass against them.

### Step 2 — HTTP routes — (Backend)
- Mounted under the write surface (write-guard + actor injection from Phase 13):
  - `POST /api/boards`, `PATCH /api/boards/:id`, archive/unarchive
  - `POST /api/boards/:id/groups`, `PATCH /api/boards/:id/groups/:gid`,
    `POST /api/boards/:id/groups/reorder`, group archive/unarchive
  - `PATCH /api/project`
- All carry the board `version` for CAS; `version_mismatch` surfaces as in Phase 13.
- **Done when:** integration tests assert `boards/*.json` content + version bump +
  atomic-write behavior; `archive_group` with active tasks → `conflict`.

### Step 3 — Column management UI — (Frontend)
- On `BoardDetail` kanban: "+ Add column" (Dialog: name, optional color),
  per-column menu (rename, recolor, archive), and **drag-to-reorder columns**
  (reuse Phase 13's `@dnd-kit`, now on columns) → `reorderGroups` with board
  `version`.
- Archiving a column with active tasks shows the `conflict` message (move/clear
  tasks first).
- **Done when:** add / rename / recolor / reorder / archive columns from the browser.

### Step 4 — Board & project metadata UI — (Frontend)
- `Boards` page: create board (Dialog), rename/archive from the board card menu.
- `Overview`: edit project name/description.
- **D9 cue:** a subtle, consistent indicator on structure edits — e.g. a small
  "edits `boards/<id>.json` — remember to commit" note in the success toast — so
  the human knows these touch tracked files (task/comment edits get no such cue).
- **Done when:** board create/rename/archive + project rename work and carry the
  commit cue.

### Step 5 — Review + acceptance + audit — (Reviewer → Assistant)
- Focus: atomic-write integrity (no torn `boards/*.json`), version CAS on
  concurrent edits, `conflict` on group-archive-with-tasks, actor stamping.
- Audit → `.agents/audits/phase-15-audit.md`; merge; tag `phase-15-complete`.

## 4. Acceptance criteria
- Add / rename / recolor / reorder / archive a column from the browser; reorder and
  edits bump the board `version` and rewrite `boards/<id>.json` atomically.
- Archiving a column that still has active tasks → `conflict` message; no write.
- Concurrent stale-version structure edit → `version_mismatch`; UI reconciles.
- Create / rename / archive a board; rename the project (`config.json`).
- Structure edits surface the "edits a tracked file — commit it" cue (D9).
- Lint / format / typecheck / unit + integration + one Playwright column test green.

## 5. Risks
- **R-14-1:** Substrate-as-code edits from the UI race with hand-edits or agent
  edits to the same file (the documented TOCTOU window, `writer.ts:139`). Board
  version CAS catches most; surface `version_mismatch` clearly. Accept the residual
  per the existing decision.
- **R-14-2:** Reorder must remain a strict permutation; lean on the existing
  validation (`reorder-groups.ts:42`) — never trust client ordering blindly.
- **R-14-3:** Users may not realize structure edits need committing. Mitigation: the
  D9 cue; documented in the UI help/README.

## 6. Definition of Done
- Column/board/project ops in `src/operations/`; HTTP routes thin; substrate-as-code
  writes atomic + CAS-guarded. Audit clean; tag `phase-15-complete`.

---

## Appendix — Phase 16 (deferred): Policy & field_schema authoring

Not scheduled. Editing the **policy DSL** and **`field_schema`** through a GUI is a
large design space (condition trees, operators, the two policy classes). The recent
work already makes **code-editing** these safe: definition validation on create/
update + load (`definition-schema.ts`) and the `substrate_corrupt` actionable
recovery error. **Recommendation:** keep policies and field_schema **agent-authored
or hand-edited** for now; reconsider a GUI editor only if the dogfood journal shows
humans need it. If taken up, it gets its own spec.
