# Phase 14 Plan — Task authoring + comments

**Status:** Draft for Diego's review (lighter — reuses Phase 13's foundation)
**Author:** Architect
**Date:** 2026-06-29
**Spec:** [interactive-ui-spec.md](specs/interactive-ui-spec.md) (umbrella)
**Depends on:** [Phase 13](phase-13-interactive-write-foundation.md) (ops layer,
HTTP write transport, write-guard, mutation/toast plumbing, form primitives).
**Theme:** Full task editing (custom fields) and the human↔agent conversation.

---

## 1. Overview

Phase 13 made tasks movable/creatable. Phase 14 fills in **the rest of a task** —
`field_schema`-driven custom-data editing and the **comments** thread — so a human
can fully author a task and talk back to the agents. It is mostly *new ops + thin
HTTP routes + forms*; the transport, security, and feedback layers already exist.

## 2. Branching
- Branch `feature/phase-14-task-authoring-comments` off `main` (post Phase 13).
- Step commits; one Code-Reviewer pass; CI green (Actions billing must be live).

## 3. Implementation order

### Step 1 — Comment operations + HTTP routes — (Backend)
- Extract ops from the MCP comment tools into `src/operations/`:
  `applyAddComment`, `applyEditComment`, `applyArchiveComment` (comments are
  append-style, **no `version`/OCC** — `edit_comment` re-reads fresh, `not_found`
  if gone; preserve that).
- HTTP routes (actor injected per D2; write-guard applies):
  - `POST  /api/tasks/:id/comments`   → add (supports `parent_id` for threads)
  - `PATCH /api/comments/:id`         → edit body / custom_data
  - `POST  /api/comments/:id/archive` → archive
- **Done when:** integration tests cover add/edit/archive incl. threaded replies.

### Step 2 — `field_schema`-driven task custom-data editing — (Backend + Frontend)
- Extend `PATCH /api/tasks/:id` (already exists from Phase 13) to accept
  `custom_data` patches; the op already validates via `field_schema`
  (`schema_violation` on bad type/missing-required) — surface it per field.
- UI: on `TaskDetail`, render an **editable field set from the board's
  `field_schema`** (D8): `required` marks, `values` enums → `Select`, types →
  input kind; unknown/free custom keys → text. Submit via `updateTask` with
  `version`; show `schema_violation.details` inline on the offending field.
- **Done when:** editing a typed/required/enum field persists or shows the precise
  validation error.

### Step 3 — Comments UI (the conversation) — (Frontend)
- On `TaskDetail` Comments tab: an **add-comment** composer (markdown source,
  preview via the single `markdown.ts` path), reply affordance on each comment
  (threaded `parent_id`), edit/archive on the human's own comments.
- Optimistic-append the new comment, reconcile on response; toast on error.
- **Done when:** a human can add, reply, edit, and archive comments; agent comments
  remain read (no edit on others' comments).

### Step 4 — Actionable missing-required badge — (Frontend)
- The kanban card + `TaskDetail` already show `missing_required_fields`. Make it
  **actionable**: clicking it deep-links to the task's edit field set scrolled to
  the first missing field. (Closes the loop the architecture review's Theme 4
  opened — visibility → action.)
- **Done when:** clicking the badge lands on the field to fill.

### Step 5 — Review + acceptance + audit — (Reviewer → Assistant)
- Security focus: markdown render path never bypassed for comment bodies;
  field-schema validation enforced server-side; actor stamping on comments.
- Audit → `.agents/audits/phase-14-audit.md`; merge; tag `phase-14-complete`.

## 4. Acceptance criteria
- Add / reply / edit / archive a comment from the browser; each emits the right
  event with a `human:` actor; threads render correctly.
- Editing a `required` field to empty → `schema_violation` shown on that field, no
  write. Editing an enum field to an out-of-`values` value → `schema_violation`.
- A valid custom-data edit persists and clears the missing-required badge.
- Comment bodies render only through `markdown.ts` (a `<script>` in a comment is
  inert).
- Lint / format / typecheck / unit + integration + one Playwright comment test green.

## 5. Risks
- **R-13-1:** `field_schema` shapes vary (enums, formats, free keys); the renderer
  must degrade gracefully to a text input for anything it doesn't model.
- **R-13-2:** Comment threading depth/markup edge cases — cap render depth, lean on
  existing pagination (`usePaginated`).

## 6. Definition of Done
- Comment + custom-data ops live in `src/operations/`; HTTP routes are thin
  adapters; behavior validated. Audit clean; tag `phase-14-complete`.
