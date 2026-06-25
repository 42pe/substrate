# Phase 11 — `list_tasks` summary projection — Spec

**Status:** Approved-direction (Diego), spec for review
**Author:** Orchestrator (synthesizing Software + DX analyst findings)
**Date:** 2026-06-25
**Companion:** [plan](../phase-11-list-tasks-projection.md)

---

## 1. Problem & motivation

`list_tasks` (MCP tool + `GET /api/tasks`) returns the **full** `Task` per row — it
shares `rowToTask` / `SELECT *` with `get_task`, so a list is literally
`get_task × N`. A real dogfood board (35 tasks) produced a **68,934-byte**
response that overflowed an agent's context and couldn't be parsed.

Size breakdown of that sample (35 tasks):

| Field | Bytes | Share |
| --- | --- | --- |
| `description` | 32,709 | 47% |
| `custom_data` | 22,669 | 33% |
| everything else (ids, title, timestamps) | ~13,556 | 20% |

Two fields are **80%** of the payload. The fields needed to *select* a task
(id, title, group, version, timestamps) are ~370 bytes/task.

The list/detail tool split already exists (`list_tasks` + `get_task`); it was
never enforced in the *payload*. This phase makes `list_tasks` a lean summary
and keeps `get_task` as the full-detail call.

## 2. Goals / non-goals

**Goals**
- `list_tasks` returns a SUMMARY row by default: enough to triage, filter, and
  select without a second call, at a fraction of the size.
- A caller can opt into the full rows with one obvious knob.
- `get_task` remains the full-detail call (unchanged).
- Agents learn the "list to find → `get_task` to read" loop from the tool
  descriptions and SKILL.md.

**Non-goals**
- No change to `get_task` output.
- No change to `GET /api/boards/:id/columns` payload (kanban is browser-side, not
  the reported agent-context pain). Noted as an optional follow-up.
- No pagination redesign (`DEFAULT_PAGE_SIZE` stays 50).
- No compat shim (Substrate is pre-npm; we change the shape directly).

## 3. Behavior

### 3.1 Default = summary

`list_tasks` (no `view`, or `view: 'summary'`) returns rows of shape
`TaskSummary`:

- **Kept verbatim** (all small): `id`, `board_id`, `group_id`, `parent_id`,
  `origin_task_id`, `title`, `version`, `created_by_agent`, `created_at`,
  `updated_at`, `archived_at`.
- **`description` → omitted**, replaced by:
  - `description_excerpt: string` — first ~200 chars, cut on a word boundary,
    `…` appended when truncated; `""` when there is no description.
  - `description_truncated: boolean` — `true` when the excerpt is shorter than
    the full description (an explicit "call get_task for the rest" signal).
- **`custom_data` → trimmed** (value-based, no field_schema needed):
  - keep `boolean`, `number`, and `string` values whose length ≤ 120;
  - drop everything else (long strings, arrays, nested objects) — these are the
    "detail" fields (acceptance criteria, doc blobs, tag lists).
  - `custom_data` holds the kept entries; `custom_data_omitted: string[]` lists
    the dropped keys so the agent knows detail exists behind `get_task`.

Rationale for value-based (not field_schema-type-based) trimming: field_schema is
only loaded when a `board_id` filter is present; value-based trimming works
uniformly, including cross-board listing, with no board load. It keeps exactly
the triage-useful fields — gate booleans (`tests_passing`), scalar enums
(`priority`, `scope`), numbers — and drops the heavy ones.

### 3.2 Opt-in full

`view: 'full'` returns the rows exactly as today (full `Task`, including
`description` and complete `custom_data`). The caller has explicitly accepted the
size.

### 3.3 Pagination

Unchanged. `DEFAULT_PAGE_SIZE` 50, `MAX_PAGE_SIZE` 200. With summary rows a
50-row page is ~10KB instead of ~70KB.

## 4. API / contract changes

- **New input field** on `list_tasks` / `GET /api/tasks`:
  `view: 'summary' | 'full'` (optional, default `'summary'`). HTTP: `?view=`.
- **New type** `TaskSummary` in `core/types.ts`.
- **`list_tasks` handler return** becomes `{ results: TaskSummary[] | Task[]; pagination }`.
- **Tool descriptions** updated for `list_tasks` (summary shape + `view` + the
  list→get_task flow) and `get_task` (positioned as the detail call).
- **UI**: `getTasks` client type becomes `Paginated<TaskSummary>` (the List view
  only reads fields present in the summary — verified).

No SQLite schema change. No new error code. No MCP tool added/removed.

## 5. Open questions (resolved)

1. **New tool vs. projection?** → Projection. The list/detail split already
   exists; `get_task` is the detail call. (Diego's framing.)
2. **field_schema-type trim vs value trim?** → Value trim (works cross-board, no
   board load). See §3.1.
3. **Keep `description` truncated under the same name?** → No — rename to
   `description_excerpt` + `description_truncated` so an agent never mistakes a
   partial body for the whole (the sample's task hid P0 detail deep in the body).
4. **Knob shape?** → `view: 'summary' | 'full'`, not `include[]`/`fields[]` (a
   field-picker is DX debt). Default summary = safe by default.
5. **Also trim board-columns?** → Out of scope this phase (browser-side; own
   type + smoke). Optional follow-up.

## 6. Edge cases

- No description → `description_excerpt: ""`, `description_truncated: false`.
- Empty `custom_data` → `custom_data: {}`, `custom_data_omitted: []`.
- All custom_data scalar & short → `custom_data_omitted: []` (nothing dropped).
- `view: 'full'` → byte-identical to today's output.
- Cross-board list (no `board_id`) → same value-based trim; no board load needed.
- `missing_required_fields` filter still works (independent of projection).

## 7. Blast radius (from Software Analyst)

- Repo `listTasks` / `rowToTask`: unchanged (stays generic full mapper).
- `get_task`, `GET /api/tasks/:id`: unchanged.
- `GET /api/boards/:id/columns`: uses a separate query; unchanged.
- UI List view (`BoardDetail.tsx`) & kanban: read only summary-present fields →
  not broken; client type updated.
- Existing tests: none assert on list `description`/`custom_data` → none break;
  new tests added for the projection.
