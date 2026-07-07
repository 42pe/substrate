# Sprint plan — "Pending human approval" reporting + UI pill + task-detail markdown fix

**Status:** Draft for Diego's review
**Author:** Architect
**Date:** 2026-07-07
**Prerequisite:** **B3 (board `human_only` fields)** from
[policy-integrity](policy-integrity.md) — that is the canonical "this field is a *human*
decision" signal, and without it "pending approval" can't distinguish a human gate
(`plan_approved`) from an agent gate (`tests_passing`). Sequence this sprint **after**
policy-integrity, or fold B3 into it. (Flagged in §Decisions.)
**Related:** the UI pill mirrors the existing `missing_required_fields` badge
(`board-columns.ts:112`, `Kanban.tsx:48`). The markdown fix is a *verify + harden* of the
Phase 12 change, not a fresh fix (see item C).

---

## Overview

One sprint, three deliverables, driven by Diego's StackChan-style pipeline where an
autonomous agent stops at human-approval gates:

- **A.** Report every task **pending human approval** across all boards — an MCP tool + a
  `substrate pending-approval` CLI + a `/substrate pending-approval` skill flow.
- **B.** A clear **"Pending approval" pill** on those tasks in the web UI.
- **C.** Fix the **task-detail markdown** rendering (plain text / no line breaks).

A and B share one server-side computation; C is independent.

---

## A. "Pending human approval" reporting

### Definition (anchored on B3 `human_only` fields)
A non-archived task is **pending human approval** when advancing it is gated on a human
decision: there is an active `transition_guard` on an outgoing transition from the task's
current group whose `require` references ≥1 field the board marks **`human_only`**, and
that/those field(s) are currently **unsatisfied**. The task is reported with:
`{ board, task, current group, gate (policy name), target group, awaiting_fields[] }`.

Rationale: the guard blocks the *move*; "pending approval" = "the human sign-off is what's
missing." We report tasks in the guard's `from_group` whose human_only requirement is unmet
(other non-human unmet conditions, if any, are noted but don't suppress the item — a human
still needs to look). Pure, board-derived, no new task state.

### Core (framework-neutral)
- `src/policy/pending-approval.ts` — `pendingApprovalFor(board, task): { pending: boolean; gate?: {policy_id, policy_name, to_group}; awaiting_fields: string[] }`. Pure: walks the board's active `transition_guard`s, intersects each guard's required fields with the board's `human_only` set, checks the task's `custom_data`. Reuses the evaluator + `human_only` list from B3.
- `src/operations/list-pending-approvals.ts` (or a read module) — aggregate across boards: load substrate, for each board list active tasks (`listTasks`), map through `pendingApprovalFor`, return the pending ones. Cross-board, like the activity feed.

### Surfaces
1. **MCP read tool `list_pending_approvals`** (`src/mcp/tools/read/`) — optional `board_id`
   filter; returns pending items (flat, with board + gate + awaiting_fields). This is what
   the skill/agents call.
2. **CLI `substrate pending-approval`** (`src/cli/commands/`) — prints them grouped by
   board/project, human-readable ("Board X → task 'Y' waiting on you to set `plan_approved`").
3. **HTTP `GET /api/pending-approvals`** (`src/http/routes/api/`) — cross-board list for a UI
   view; plus the **per-task flag** for the pill (item B).
4. **Skill** — `skills/substrate/SKILL.md` gains a "Report pending human approvals" flow: on
   `/substrate pending-approval`, call `list_pending_approvals` and present grouped by
   project/board with the gate + exactly what the human must set to unblock each. (No new
   skill file needed; it's a substrate-skill capability.)

## B. UI "Pending approval" pill

Mirror the `missing_required_fields` pattern exactly:
- **Server flag:** `board-columns.ts` already maps each task to `{ ...t, missing_required_fields }`
  (`:112`). Add `pending_approval: boolean` + `awaiting_fields: string[]` computed via
  `pendingApprovalFor(board, t)`. Extend `ColumnTask` (`board-columns.ts:35`, `ui/src/lib/api.ts:33`).
- **Task detail:** include the same flag on the task-detail payload (or a small
  `GET /api/tasks/:id/approval` — prefer folding it into the existing task read the detail
  page already makes).
- **Pill (UI):** a distinct **"Pending approval"** pill (own accent — NOT reusing the
  amber missing-required style; e.g. a `--pending`/violet token so the two signals are
  visually separable) on:
  - the **kanban card** (`Kanban.tsx` `KanbanCard`, next to the missing-required badge),
  - the **task-detail** header (near the group/version badges),
  - (nice-to-have) the **List view** row + a board-level **filter** "Pending approval only",
  - (nice-to-have) an **Overview** roll-up count ("N awaiting you").
  Hover/title shows the gate + `awaiting_fields`. Accessible name includes "pending human approval".

## C. Task-detail markdown — verify + harden (NOT a fresh fix)

**Status of the code:** already correct on `main`. `renderMarkdown` uses
`marked.parse(src, { breaks: true })` (`ui/src/lib/markdown.ts:22`), `<Markdown>` applies the
tokenized `.markdown` class (`Markdown.tsx:18`), and TaskDetail renders the description
(`:62`) and comments (`:128`) through it. This was the Phase 12 fix. **The reported symptom
(plain text / no line breaks) matches a *pre-Phase-12* bundle**, so step 1 is to rule out a
**stale running `serve`** (a long-lived `serve` serves the old `dist/ui` until restarted).

Steps:
1. **Reproduce on a fresh build** (`pnpm build:ui` + serve a seeded board with a multi-line,
   bold, list-containing description). If it renders correctly → the field bug was stale
   serve; document "restart `serve` after updating" and we're done for the field case.
2. If a genuine gap remains, fix it. Candidates already visible:
   - **Redundant nesting:** the description `CardContent` has `className="markdown …"` *and*
     `<Markdown>` emits its own `.markdown` div (`TaskDetail.tsx:61-63`; same for comments
     `:127-128`). Drop the `.markdown` from the outer `CardContent` (let `<Markdown>` own it).
   - Confirm the `.markdown` stylesheet (`styles.css`) covers `strong`, `em`, `ul`/`ol`,
     `code`, `pre`, `blockquote`, `br`, headings — add any missing element.
3. **Regression test:** extend the Playwright UI smoke (`tests/smoke/ui.spec.ts`) — a task
   whose description has a bold word + two lines separated by a single `\n` renders a
   `<strong>` and a `<br>` (proves both symptoms are closed end-to-end in the built app).

## Decisions (needs Diego)

1. **Sequencing / dependency.** This needs B3 (`human_only`). Options: (a) **sequence after
   policy-integrity** (recommended — B3 is the next cluster anyway); (b) fold the minimal B3
   `human_only`-field definition into this sprint. *Rec: (a).*
2. **Pill scope.** Ship the pill on kanban card + task detail only (leanest), or also the
   List filter + Overview roll-up? *Rec: card + detail now; filter/roll-up as nice-to-have.*
3. **Dedicated `/pending` UI route?** The skill + CLI already give the cross-board list; a UI
   route is optional. *Rec: skip for v1; the pill + the skill/CLI cover it.*
4. **"Ready" precision.** Report all tasks in a human-gate's `from_group` with the human
   field unset (simple, may include not-yet-ready tasks), or only those whose *other* guard
   conditions are already met (truly "only the human is missing")? *Rec: start simple + note
   other unmet conditions; tighten if the dogfood shows noise.*

## Implementation order
1. **B3 prerequisite** landed (policy-integrity) — `human_only` fields exist.
2. Core `pending-approval.ts` + unit tests (pure function over board+task fixtures).
3. `list_pending_approvals` MCP tool + `GET /api/pending-approvals` + `substrate
   pending-approval` CLI (share the aggregate) + tests.
4. SKILL.md pending-approval flow.
5. Server flag on `board-columns` + task-detail payload; extend `ColumnTask`/UI types.
6. UI pill (kanban + task detail) + a `--pending` token; (nice-to-have) List filter / Overview count.
7. Markdown: verify-on-fresh-build → harden (denest) → Playwright regression.
8. Review gate (two reviewers, must complete) → PR → Diego approval → merge.

## Acceptance criteria (validate locally — CI billing-permitting)
- `list_pending_approvals` returns exactly the tasks whose progress is blocked by an unset
  `human_only` field, with the gate + `awaiting_fields`; excludes agent-gated (`tests_passing`)
  and already-approved tasks. `substrate pending-approval` prints them grouped by board.
- `/substrate pending-approval` produces a correct cross-board report.
- A pending-approval task shows a distinct **"Pending approval"** pill on its kanban card and
  task-detail; a non-pending task doesn't; hover shows the awaiting field(s). Distinguishable
  from the missing-required badge.
- Task-detail description renders markdown (bold, lists) **with line breaks** in a freshly
  built app; the Playwright smoke asserts `<strong>` + `<br>`.
- `pnpm lint` / `format` / `tsc` / unit + integration + UI smoke green.

## Risks
- **R1:** the "pending" definition can over-report if a task isn't otherwise ready (Decision 4).
  Mitigation: note other unmet conditions; tighten per dogfood.
- **R2:** hard dependency on B3 — this sprint is blocked until policy-integrity lands. State it.
- **R3:** the markdown "bug" may be entirely stale-serve; don't invent a code fix. Step 1
  reproduces on a fresh build before touching anything.

## DoD
Branch `feature/pending-approval`; steps above; completed two-reviewer gate; PR for Diego's
approval; `decisions.md` records the pending-approval definition + the pill; SKILL.md +
CHANGELOG updated. After merge, rebuild + reinstall Diego's global copy.
