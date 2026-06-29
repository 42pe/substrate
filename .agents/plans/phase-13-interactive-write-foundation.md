# Phase 13 Plan — Interactive write foundation + task moves

**Status:** Draft for Diego's review
**Author:** Architect
**Date:** 2026-06-29
**Spec:** [interactive-ui-spec.md](specs/interactive-ui-spec.md) (umbrella)
**Theme:** Make the board human-writable, starting with the transport + the
highest-value interaction (drag a card between columns).

---

## 1. Overview

Phase 13 builds the **foundation** every later interactive phase reuses — a
framework-neutral operations layer, an HTTP write transport, a CSRF write-guard,
and the UI's mutation/optimistic/toast plumbing — and proves it end-to-end on the
**task lifecycle**: move (drag), create, edit, archive/unarchive. After this
phase a human can run the kanban with their hands; agents and the human share one
policy-checked, event-logged write path.

## 2. Branching & merge strategy

- Branch `feature/phase-13-interactive-write-foundation` off `main`.
- Step commits; one Code-Reviewer pass at the end (per workflow.md).
- CI must be green — **note: blocked until the GitHub Actions minutes/spending
  limit is resolved** (see decisions.md "Windows CI" postscript). Don't start the
  build until CI can validate.

## 3. Implementation order

### Step 1 — Extract the operations layer (refactor, no behavior change) — (Backend)
- Create `src/operations/` (depends on `core, storage, substrate, policy, shared`;
  **not** on `mcp`/`http`).
- For each task-lifecycle write, move the orchestration body out of
  `src/mcp/tools/write/*` into a neutral op returning `SuccessEnvelope | ErrorEnvelope`:
  - `applyCreateTask(input, deps)` ← `create-task.ts`
  - `applyUpdateTask(input, deps)` ← `update-task.ts:51` (the canonical shape:
    `withTransaction` → `getTask` → `runTransitionGuards` → `updateTask` →
    `appendEvent` → `successEnvelope`)
  - `applyArchiveTask` / `applyUnarchiveTask` (respect the `changed` no-op skip)
- `deps` (`ToolDeps`) already carries `{ client, root, config }`; keep it.
- MCP write tools become thin adapters: zod-parse → call op → MCP-format. **Their
  behavior is unchanged**; move/adjust their tests to target the ops directly so
  the extraction is pinned. Keep `agent_name` in the op input (the caller supplies
  it — MCP from the agent, HTTP injected per D2).
- Enforce the boundary with the existing `import/no-cycle` ESLint rule; add a lint
  guard that `http` never imports `mcp` and vice-versa.
- **Done when:** all existing MCP write tests pass against the ops; `tsc`/lint green.

### Step 2 — HTTP write transport (task subset) — (Backend)
- New `src/http/routes/api/write/` with routes mounted in `server.ts` after the
  read routes:
  - `POST   /api/tasks`               → `applyCreateTask`
  - `PATCH  /api/tasks/:id`           → `applyUpdateTask` (title, description,
    `group_id` for moves; `custom_data` deferred to Phase 14)
  - `POST   /api/tasks/:id/archive`   → `applyArchiveTask`
  - `POST   /api/tasks/:id/unarchive` → `applyUnarchiveTask`
- Each route: parse body with the **same zod schema** the MCP tool uses (export it
  from the op module), **inject the actor** (D2: `human:<os-username>` or
  `config.ui_actor_name`), call the op, then:
  - `ok` → `c.json(envelope, 200)`
  - `!ok` → `c.json(envelope, httpStatusFor(error.code))` (reuse `errors.ts`
    mapping; `transition_blocked`/`version_mismatch`/`schema_violation` already map)
- No new error codes; no envelope changes.
- **Done when:** integration tests POST/PATCH each route and assert envelope + DB
  row + emitted `TaskEvent` (with `human:` actor).

### Step 3 — CSRF / write-guard middleware (D3) — (Backend/Security)
- New `src/http/middleware/write-guard.ts`, applied to non-GET methods only:
  - reject unless `Sec-Fetch-Site ∈ {same-origin, none}` **when present**, AND
    a required `X-Substrate-Client` header is present.
  - failure → `SubstrateError.forbidden(...)` → 403 (same shape as origin guard).
- Layer it after `originAllowlist` in `server.ts`.
- The UI's `apiFetch` always sends `X-Substrate-Client: ui` (Step 4).
- **Done when:** unit tests — cross-origin POST 403; missing header 403;
  same-origin+header pass; GET unaffected. Manual `curl` cross-origin write → 403.

### Step 4 — UI mutation layer (transport + feedback) — (Frontend)
- `ui/src/lib/api.ts`: add `apiPost`/`apiPatch` mirroring `apiGet`, always sending
  `X-Substrate-Client: ui` + `Content-Type: application/json`; parse the envelope,
  throw a typed `ApiError` carrying `{ code, message, details }` on `!ok`.
- Client fns: `moveTask`, `updateTask`, `createTask`, `archiveTask`,
  `unarchiveTask` (request/response types from `@core/types` + envelope types).
- `ui/src/lib/useMutation.ts`: `{ status, error, mutate }` hook (idle/pending/
  error/success), parallel in spirit to `useResource`.
- **Toasts:** vendor a minimal `Toast`/`Toaster` (ShadCN) + a `useToast` queue;
  mount in `Layout`. Used for success, policy blocks, and conflicts.
- **Done when:** a throwaway button can create a task and a toast confirms it.

### Step 5 — Kanban drag-to-move (the headline) — (Frontend)
- Add `@dnd-kit/core` + `@dnd-kit/sortable` to `ui/package.json` (D5).
- Make `KanbanColumn`/`KanbanCard` (`components/Kanban.tsx`) droppable/draggable;
  keep the read-only link behavior on click (drag vs click disambiguated by dnd-kit
  activation constraint).
- On drop to a new column: **optimistic** move (card jumps), then
  `moveTask(id, { group_id, version })`:
  - success → toast "Moved · agent_responsibility suggestion?" (surface any
    `policies_fired` `agent_responsibility` message), refetch columns immediately.
  - `transition_blocked` → **revert** the card, toast the guard's
    `on_failure_message` (D1).
  - `version_mismatch` → revert, refetch, toast "changed underneath you" (D4).
- **Keyboard/menu equivalent:** a "Move to…" control on each card (dnd-kit keyboard
  sensor + a simple menu) so moving works without a mouse.
- Pause the 4s poll mid-drag; resume + immediate refetch after.
- **Done when:** dragging a card persists (DB + event), a guard-blocked drag
  reverts with the message, keyboard move works.

### Step 6 — Task create / edit / archive UI — (Frontend)
- Vendor ShadCN `Button`, `Input`, `Textarea`, `Label`, `Select`, `Dialog` (D6).
- **Create:** "+ New task" per column → Dialog (title required, description
  markdown-source, group preselected) → `createTask` → refetch.
- **Edit:** on `TaskDetail`, an "Edit" affordance for title/description/group →
  `updateTask` with `version`; description still **renders** only through
  `markdown.ts`.
- **Archive/Unarchive:** button on `TaskDetail` (+ optional card menu) →
  `archiveTask`/`unarchiveTask`, optimistic with toast.
- Flip the `Layout` footer copy from "read-only inspector" when writes are enabled.
- **Done when:** create/edit/archive work from the browser and reflect after refetch.

### Step 7 — Code-Reviewer pass + acceptance + audit — (Reviewer → Assistant)
- Security review focus: the write-guard (D3), actor stamping (D2), no policy
  bypass (D1), no markdown render path bypassed.
- Acceptance battery (below) green; `.agents/audits/phase-13-audit.md` written;
  fast-forward merge; tag `phase-13-complete`.

## 4. Acceptance criteria

- Dragging a card to another column persists the move (DB + `TaskEvent` with a
  `human:` actor) and survives reload.
- A board with a `transition_guard` that forbids the move: the drag **reverts** and
  the guard's `on_failure_message` is shown; **nothing is written**.
- A stale-version move returns `version_mismatch`; UI refetches and reconciles.
- `curl -X POST` cross-origin (bad Origin) → 403; same-origin without
  `X-Substrate-Client` → 403; with it → 200.
- Create / edit / archive / unarchive a task from the browser, each emitting the
  right event with the human actor.
- All **existing** MCP write tests still pass (extraction was behavior-preserving).
- `agent_responsibility` suggestions surface (non-blocking) on a matching move.
- `pnpm lint`, `pnpm format:check`, `tsc --noEmit`, unit + integration + the one
  Playwright interaction test green. `http`↛`mcp` boundary holds.

## 5. Operator / Diego tasks (not done by the agent)
- Resolve the GitHub Actions minutes/spending block so CI can validate.
- Confirm D2 actor naming and D5 (`@dnd-kit`) per the spec's open questions.

## 6. Test mapping
- Ops extraction → moved MCP write unit tests target `src/operations/*`.
- HTTP writes → `tests/integration/http-write-*.test.ts` (route → envelope → state).
- Write-guard → `src/http/middleware/write-guard.test.ts`.
- Policy-on-human-write + OCC → integration with a guarded fixture board.
- Drag interaction → extend `tests/smoke/ui.spec.ts` (drag card → assert persisted).

## 7. Risks
- **R-12-1:** Ops extraction touches every write tool — risk of subtle behavior
  drift. Mitigation: extract one op at a time, keep tests green between each.
- **R-12-2:** dnd-kit + the 4s in-place poll can fight (card snaps back mid-drag).
  Mitigation: pause polling during an active drag; reconcile on drop.
- **R-12-3:** Click-vs-drag ambiguity on cards (cards are links). Mitigation:
  dnd-kit activation constraint (distance/delay) so a click still navigates.
- **R-12-4:** CSRF guard too strict could 403 legitimate writes in odd browsers.
  Mitigation: accept `Sec-Fetch-Site` absent (older browsers) but always require
  the custom header; integration-test the matrix.

## 8. Definition of Done
- All acceptance criteria met; Code-Reviewer BLOCKER/CONCERN resolved.
- `src/operations/` is the single write path; `mcp` and `http` are thin adapters
  over it and still don't import each other.
- Audit clean → `.agents/audits/phase-13-audit.md`; fast-forward merge to `main`;
  tag `phase-13-complete`. Footer/docs updated to reflect the UI can now write.
