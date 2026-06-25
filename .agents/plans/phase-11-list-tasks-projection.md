# Phase 11 — `list_tasks` summary projection — Plan

**Status:** Draft for Architect-Reviewer
**Spec:** [phase-11-list-tasks-projection-spec.md](specs/phase-11-list-tasks-projection-spec.md)
**Date:** 2026-06-25

---

## Approach

Project in the **`list_tasks` handler** (shared by the MCP tool and
`GET /api/tasks`). The repo (`listTasks` / `rowToTask`) stays a generic
full-row mapper. A pure `toTaskSummary(task)` function does the trimming so it's
unit-testable in isolation. `view: 'full'` bypasses projection and returns the
full rows unchanged.

## Implementation steps

### 1. `src/core/types.ts` — add `TaskSummary`
```ts
export interface TaskSummary {
  id: string; board_id: string; group_id: string;
  parent_id: string | null; origin_task_id: string | null;
  title: string;
  description_excerpt: string;     // ≤ ~200 chars, word-boundary, "…" if cut
  description_truncated: boolean;  // excerpt < full description
  custom_data: Record<string, unknown>; // trimmed: scalars only
  custom_data_omitted: string[];        // keys dropped from the trim
  version: number; created_by_agent: string;
  created_at: string; updated_at: string; archived_at: string | null;
}
```

### 2. `src/core/task-summary.ts` (new) — the projection
- Constants: `DESCRIPTION_EXCERPT_MAX = 200`, `CUSTOM_VALUE_STRING_MAX = 120`.
- `toTaskSummary(task: Task): TaskSummary`:
  - `description_excerpt` = `excerpt(task.description, 200)`; `description_truncated` = excerpt length < description length.
  - Walk `custom_data`: keep `boolean`/`number`; keep `string` if `length ≤ 120`;
    otherwise push key to `custom_data_omitted`. (arrays/objects/long strings dropped.)
  - Copy the verbatim small fields.
- `excerpt(s, max)` helper: trim to ≤ max on the last word boundary before `max`,
  append `…` only when truncated; `""` for empty/missing.

### 3. `src/mcp/tools/read/list-tasks.ts`
- Add to `listTasksShape`: `view: z.enum(['summary', 'full']).optional().default('summary')`.
- Change handler return type to `{ results: TaskSummary[] | Task[]; pagination: PaginationOutput }`.
- At the two return points (the missing-required empty short-circuit returns `[]`
  — fine for both views): after `const full = await listTasks(...)`, return
  `input.view === 'full' ? full : { results: full.results.map(toTaskSummary), pagination: full.pagination }`.
- Replace the tool description with the DX-approved copy (summary shape + `view`
  + list→get_task flow).

### 4. `src/http/routes/api/index.ts`
- In the `/api/tasks` route, add `view: strParam(q('view'))` to the `validateInput`
  object so `?view=full` flows through (the Zod default fills `summary`).

### 5. `src/mcp/tools/read/get-task.ts`
- One-line description tweak: position as the full-detail call ("Returns all
  fields incl. full description and custom_data; use after `list_tasks` summary").

### 6. UI
- `ui/src/lib/api.ts`: add `TaskSummary` (mirror of core) and change
  `getTasks` return to `Paginated<TaskSummary>`.
- `ui/src/routes/BoardDetail.tsx` List view: no render change (uses id/title/
  group_id/updated_at/archived_at — all in summary); only the inferred type
  changes. Verify `tsc`.

### 7. Docs
- `skills/substrate/SKILL.md` "typical loop": note list returns summary rows;
  call `get_task(id)` for full description/custom fields.
- `CHANGELOG.md` (Unreleased): user-facing entry.

## Acceptance criteria
- `list_tasks` with no `view` returns rows with **no `description` field**, a
  bounded `description_excerpt`, `description_truncated`, a scalar-only
  `custom_data`, and `custom_data_omitted` listing dropped keys.
- `view: 'full'` returns byte-identical output to today (full `Task`).
- `GET /api/tasks` mirrors both (`?view=full`).
- `get_task` unchanged (full).
- Build + root/ui typecheck + lint + format + all tests + both smoke suites green.
- The bundled example/smoke board still lists; UI List view renders.

## Test strategy
- **`src/core/task-summary.test.ts`** (unit, pure): excerpt truncation +
  word-boundary + empty + exactly-at-limit; custom_data trim (bool/number/short
  string kept; long string/array/object dropped → `custom_data_omitted`);
  `description_truncated` true/false.
- **`list-tasks.test.ts`**: default = summary (assert no `description`, excerpt
  present, heavy custom field omitted, gate boolean kept); `view:'full'` =
  full description + custom_data present.
- **`api.test.ts`**: `GET /api/tasks` default summary; `?view=full` full.
- No existing test rewrites expected (none assert list description/custom_data).

## Risks / mitigations
- **Agent acts on a partial body.** Mitigated by the explicit
  `description_truncated` flag + renamed `description_excerpt` (never reuse
  `description`).
- **A board encodes triage state in a long string field** (would be omitted).
  Acceptable: `custom_data_omitted` signals it; agent can `get_task` or use a
  `custom_field` filter. Document in the tool description.
- **Type drift between core `TaskSummary` and the ui mirror.** Same pattern as
  the existing `BoardColumn`/`ColumnTask` mirrors; covered by ui `tsc`.

## Out of scope (this phase)
- Trimming `GET /api/boards/:id/columns` (optional follow-up).
- Pagination changes. `automation`/other tools.

---

## Architect-Reviewer resolutions (applied before build)

1. **BLOCKER — excerpt must be grapheme-safe.** Real descriptions contain emoji
   (🔴 in the sample). Naive `slice(0, max)` splits surrogate pairs → `�`. Use
   `Intl.Segmenter('en',{granularity:'grapheme'})` to truncate on whole
   graphemes, then back off to the last word boundary; compare lengths in
   graphemes so `description_truncated` is accurate. Add an emoji unit test.
2. **`null` custom values are KEPT, not omitted.** `typeof null === 'object'`
   would wrongly bucket a cheap, meaningful `null` into `custom_data_omitted`.
   Trim rule: keep `boolean | number | null | string(≤120)`; omit arrays,
   objects, and long strings. (Spec §6 amended.)
3. **`view` is a TOP-LEVEL field**, sibling to `sort`/`pagination` — in the
   `/api/tasks` route put `view: strParam(q('view'))` at the top level of the
   `validateInput` object, NOT inside `filters` (or the Zod default always wins).
   `?view=` (empty) or an unknown value → `schema_violation`/400 (accepted).
4. **Tighten UI typing:** the ui `getTasks` client drops any `view` param and
   returns `Paginated<TaskSummary>` only, so the full branch is unreachable from
   the browser (the invariant lives in the type, not a comment). The server
   handler keeps the honest `TaskSummary[] | Task[]` union.
5. **Filter correctness is preserved** (the repo is unchanged, so `custom_field`
   predicates still run in SQL against the full row even when the value is
   trimmed from the projection). Add a test asserting this, and say it in the
   tool description.
6. **More tests:** emoji/grapheme excerpt; `null` kept; array/object →
   `custom_data_omitted` (assert the key is listed); `custom_field` filter still
   matches a row whose value was trimmed; `view:'full'` deep-equals the full
   `Task`.
7. **Test-fixture fix:** `ui/src/routes/BoardDetail.test.tsx` `emptyPage` typed
   `Paginated<Task>` (used as the `getTasks` mock return) retypes to
   `Paginated<TaskSummary>`.
