# Phase 2 Spec — Storage + Reads + Writes (no policy engine)

**Status:** ✅ Approved 2026-05-28 (all 17 recommended decisions confirmed; all 4 open questions resolved per recommendation — see §6)
**Author:** Orchestrator (synthesized from Spec Team — Software / Reliability / DX analysts ran in parallel)
**Last updated:** 2026-05-28
**Parent plan:** [`../v1-architecture.md`](../v1-architecture.md) §5 Phase 2
**Workflow:** [`../../workflow.md`](../../workflow.md)

---

## 1. Scope

Implement the full task/comment/event storage layer and every singleton read/write MCP tool. No policy engine, no substrate-edit tools, no HTTP API mirror — those land in Phase 3 / 4 / 5.

**In scope:**

- Migration 002: `comments` + `task_events` tables
- New core types: `Comment`, `TaskEvent`, `TaskEventType`, `Board`, `Group`, `Policy`, `FieldSchema`, `FieldSchemaEntry`, `Substrate`
- `withTransaction(client, fn)` helper (Phase 1 carry-forward — libsql `busy_timeout` reset quirk)
- Substrate JSON layer: `src/substrate/{loader,validator,field-validator,schemas}.ts`
- Repository expansion: `repositories/tasks.ts` (update, archive, unarchive, list); new `repositories/comments.ts`; new `repositories/events.ts`
- All 9 read MCP tools (`whoami` expanded, `get_project`, `list_boards`, `get_board_substrate`, `list_tasks`, `get_task`, `get_task_history`, `list_comments`, `get_comment`)
- All 7 singleton write MCP tools (`create_task` expanded, `update_task`, `archive_task`, `unarchive_task`, `add_comment`, `edit_comment`, `archive_comment`)
- `field_schema` validation on every write (lazy, touched fields only)
- TaskEvent emission on every write (atomic with the write via `withTransaction`)
- OCC `version_mismatch` semantics (no `current_version` returned)
- Server-side markdown sanitization helper (`shared/sanitize.ts`)
- `ToolDeps` extension to inject a `loadSubstrate` function

**Out of scope (deferred):**

- Policy engine, `transition_guard`, `agent_responsibility` evaluation (Phase 3)
- Easter-egg hint in `whoami` + `reverse_captcha` stub (Phase 3)
- Substrate-edit tools (Phase 4)
- HTTP API endpoints mirroring MCP reads (Phase 5)
- Web UI substrate inspector (Phase 5)
- `automation` and `validation` policy classes (cut from v1 entirely)
- Batch write tools, `fork_task`, webhook actions, FTS5 / vector search

## 2. Goals

- Every spec §8 acceptance criterion satisfied.
- Every write is **atomic** with its TaskEvent emission (no half-states leaking on crash).
- `withTransaction` re-applies `busy_timeout` after commit AND after rollback (defensive); subsequent statements on the same Client see the configured timeout.
- Substrate JSON layer is read fresh on every MCP call (no cache, per PRD §6.2).
- Reads come before writes during implementation so substrate fixture work isolates bugs from write paths.
- The full Phase 1 bootstrap-flow (`whoami` → `get_board_substrate` → `list_tasks` → `get_task` → `update_task`) works end-to-end against a real Substrate fixture.

## 3. Detailed behavior

### 3.1 Migration 002

Append to the `migrations` list in `src/storage/migrations/runner.ts`. Stamps `PRAGMA user_version = 2` on commit (runner handles this).

```sql
CREATE TABLE comments (
  id                TEXT PRIMARY KEY,
  task_id           TEXT NOT NULL,
  parent_id         TEXT,
  body              TEXT NOT NULL DEFAULT '',
  custom_data       TEXT NOT NULL DEFAULT '{}',
  created_by_agent  TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  edited_at         TEXT,
  archived_at       TEXT
);
CREATE INDEX idx_comments_task_id    ON comments(task_id);
CREATE INDEX idx_comments_parent_id  ON comments(parent_id);
CREATE INDEX idx_comments_archived_at ON comments(archived_at);

CREATE TABLE task_events (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id           TEXT NOT NULL,
  event_type        TEXT NOT NULL,
  changes           TEXT NOT NULL DEFAULT '{}',
  actor_agent_name  TEXT NOT NULL,
  occurred_at       TEXT NOT NULL
);
CREATE INDEX idx_task_events_task_id              ON task_events(task_id);
CREATE INDEX idx_task_events_occurred_at          ON task_events(occurred_at);
CREATE INDEX idx_task_events_task_id_occurred_at  ON task_events(task_id, occurred_at);
CREATE INDEX idx_task_events_event_type           ON task_events(event_type);
```

Notes:
- **No FOREIGN KEY clauses.** libsql requires `PRAGMA foreign_keys = ON` per connection to enforce; we deliberately keep app-layer validation only, matching the Phase 1 stance. Document in migration header.
- **No `version` column on `comments`.** Design doc §Entities: append-only / last-write-wins on edits.
- **`task_events.id` is INTEGER AUTOINCREMENT.** Free monotonic ordering for tied `occurred_at` timestamps. Diverges from design doc §TaskEvent (`id uuid`); see resolved decision §6.
- **`event_type` is TEXT** with app-layer enum (`TaskEventType` in `core/types.ts`). No CHECK constraint — cheaper to evolve.
- **`changes` is JSON TEXT.** Shape varies by `event_type`; documented in §3.2.

### 3.2 New types in `src/core/types.ts`

```ts
export interface Comment {
  id: string;
  task_id: string;
  parent_id: string | null;
  body: string;
  custom_data: Record<string, unknown>;
  created_by_agent: string;
  created_at: string;
  edited_at: string | null;
  archived_at: string | null;
}

export type TaskEventType =
  | 'created' | 'updated' | 'archived' | 'unarchived'
  | 'comment_added' | 'comment_edited' | 'comment_archived';

export interface TaskEvent {
  id: number;                     // INTEGER AUTOINCREMENT, not uuid
  task_id: string;
  event_type: TaskEventType;
  changes: Record<string, unknown>;
  actor_agent_name: string;
  occurred_at: string;
}

export interface FieldSchemaEntry {
  type: 'string' | 'number' | 'boolean' | 'enum' | 'markdown' | 'string_list';
  required?: boolean;
  format?: string;                // informational in v1, not enforced
  values?: string[];              // for type='enum'
}

export interface FieldSchema {
  task:     Record<string, FieldSchemaEntry>;
  comments: Record<string, FieldSchemaEntry>;
}

export interface Group {
  id: string;
  name: string;
  description: string;
  position: number;
  color: string | null;
  version: number;
  archived_at: string | null;
}

export interface Policy {
  id: string;
  name: string;
  description: string;
  type: 'transition_guard' | 'agent_responsibility';
  definition: Record<string, unknown>;
  priority: number;
  enabled: boolean;
  version: number;
  created_by_agent: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface Board {
  id: string;
  name: string;
  description: string;
  field_schema: FieldSchema;
  groups: Group[];                // nested in boards/<id>.json
  policies: Policy[];             // nested; structural type only in Phase 2
  version: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface Substrate {
  config: Config;
  boards: Board[];
}
```

**TaskEvent `changes` shapes by event_type:**

| event_type | `changes` shape |
|---|---|
| `created` | `{ initial_state: Partial<Task> }` — fields the caller explicitly set (not server-derived defaults) |
| `updated` | `{ before: Partial<Task>, after: Partial<Task> }` — only the touched keys, with pre and post values |
| `archived` | `{}` |
| `unarchived` | `{}` |
| `comment_added` | `{ comment_id: string }` |
| `comment_edited` | `{ comment_id: string, before: { body?, custom_data? }, after: { body?, custom_data? } }` — **including the prior body** so last-write-wins data loss is auditable |
| `comment_archived` | `{ comment_id: string }` |

### 3.3 `withTransaction` helper

```ts
// src/storage/client.ts (alongside openClient + openDatabaseAndMigrate)

export async function withTransaction<T>(
  client: Client,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T>
```

Behavior:
1. `const tx = await client.transaction('write')`
2. `try { const result = await fn(tx); await tx.commit(); return result; }`
3. On any error: `try { await tx.rollback(); } catch (rollbackErr) { attach as Error.cause }`; rethrow original.
4. **`finally`**: `await client.execute('PRAGMA busy_timeout = 5000').catch(() => undefined)` — re-applies on commit, rollback, and rollback-failure paths. Swallows PRAGMA error if connection is dead so the original failure signal isn't masked.

Used by every Phase 2 write tool. Migration runner refactor to use it is **deferred** (low-risk cleanup, not a Phase 2 deliverable).

### 3.4 Substrate JSON layer

New module: `src/substrate/`.

```
src/substrate/
  loader.ts          # loadSubstrate(root): Promise<Substrate>
  validator.ts       # validateSubstrate(substrate): void (throws on cross-board issues)
  field-validator.ts # validateFieldSchema(ctx): void (per-write runtime check)
  schemas.ts         # Zod schemas for boards/*.json shape
```

**`loadSubstrate(root)` behavior:**
1. Reads `<root>/config.json` via `shared/config.ts` `readConfig`.
2. Globs `<root>/boards/*.json`. If `boards/` directory missing → return `{ config, boards: [] }`.
3. Parses each board file via Zod (`schemas.ts`). On parse fail → `SubstrateError.internalError('Malformed boards/<filename>: <msg>')`.
4. On shape fail → `SubstrateError.internalError('Invalid boards/<filename> shape', { issues })`.
5. Calls `validateSubstrate(substrate)` for cross-board structural checks.
6. **Strict loading**: any single bad file fails the whole load. Aligned with Phase 1's `config.ts` strictness; the user wants to know their board is broken, not have it silently disappear.

**`validateSubstrate(substrate)` checks:**
- Duplicate board IDs across boards: `internal_error`.
- Duplicate group IDs within a board: `internal_error`.
- Malformed `field_schema` entries (`type='enum'` without `values`): `internal_error`.
- Policies referencing `group_id` that doesn't exist in the same board: `internal_error`.
- Policies referencing an archived group: **allowed** at load (engine in Phase 3 decides what to do at evaluation time).

**`validateFieldSchema(ctx)` behavior** (per-write runtime validation):

```ts
export interface FieldValidationContext {
  field_schema: Record<string, FieldSchemaEntry>;
  merged_custom_data: Record<string, unknown>;
  touched_keys: string[];
}

export function validateFieldSchema(ctx: FieldValidationContext): void;
// throws SubstrateError.schemaViolation on first failure
```

Rules:
- Walk `touched_keys`. For each declared in `field_schema`, check `type` and (if `type='enum'`) `values`.
- **Skip undeclared keys** — `custom_data` is free-form per design doc; extras are allowed.
- **Do NOT enforce `required` at write time** — PRD §6.10 lazy validation: required-but-missing is surfaced via `list_tasks(missing_required_fields: true)`, never blocks a write. A `create_task` that omits a required field succeeds.
- Type checks:
  - `string` → `typeof === 'string'`
  - `number` → `typeof === 'number'` and `Number.isFinite`
  - `boolean` → `typeof === 'boolean'`
  - `enum` → string AND in `entry.values`
  - `markdown` → `typeof === 'string'` (no markdown-specific check in v1)
  - `string_list` → `Array.isArray` AND every element `typeof === 'string'`
- `null` on a touched key means "delete this key" per partial-merge rules; deletion is always allowed regardless of declared type.
- `format` is informational (not enforced).

Error message style: `"Field '<name>' must be <expected>, got <actual>. Update custom_data.<name> and retry."` Details: `{ field, expected, got }`.

### 3.5 Repository layer

#### `repositories/tasks.ts` (expand existing)

Phase 1's `createTask` and `getTask` stay. Refactor both to accept `Client | Transaction` (libsql exposes `.execute()` on both; tests pass Client, write tools pass Transaction).

Add:

```ts
export async function updateTask(
  exec: Client | Transaction,
  id: string,
  expectedVersion: number,
  patch: TaskPatch,            // post-merge values, NOT raw input
  now: string,
): Promise<Task>;
// throws SubstrateError.notFound, .versionMismatch, or .conflict (archived)

export async function archiveTask(
  exec, id, expectedVersion, now,
): Promise<Task>;

export async function unarchiveTask(
  exec, id, expectedVersion, now,
): Promise<Task>;

export interface ListTasksFilters { /* per PRD §6.5 — see §3.6 list_tasks below */ }
export async function listTasks(
  exec: Client,
  opts: ListTasksOptions,
): Promise<{ results: Task[]; pagination: PaginationOutput }>;
```

OCC pattern (per Reliability §C):

```ts
return withTransaction(client, async (tx) => {
  // 1. SELECT current row for not_found / archived / version checks
  // 2. UPDATE ... SET ..., version = version + 1 WHERE id = ? AND version = ?
  //    if rowsAffected === 0: SubstrateError.versionMismatch (no current_version)
  // 3. INSERT into task_events (atomic with the update)
  // 4. Return the post-write Task
});
```

`list_tasks` filter implementation:
- Standard SQL columns (`board_id`, `group_id`, `archived_at`, `created_at`, `updated_at`, `parent_id`) → indexed WHERE clauses.
- `in_groups` / `not_in_groups` → `group_id IN (...)` / `NOT IN (...)`.
- `has_subtasks` → `EXISTS (SELECT 1 FROM tasks t2 WHERE t2.parent_id = tasks.id)`.
- `custom_field` → `json_extract(custom_data, '$.<field>') <op> ?` via libsql JSON1.
- `missing_required_fields` → handler computes required-keys list from substrate, builds `OR (json_extract(custom_data, '$.<key>') IS NULL)` per required field. **Requires `filters.board_id` to be set** (need a single board's schema); rejected with `schema_violation` otherwise.
- `text_search` → `(title LIKE '%' || ? || '%' COLLATE NOCASE OR description LIKE '%' || ? || '%' COLLATE NOCASE)`. No FTS5 in v1.

Pagination cursor: `base64url(JSON.stringify({ u: updated_at_iso, i: id }))`. Query becomes `WHERE (updated_at, id) > (cursor.u, cursor.i) ORDER BY updated_at, id LIMIT page_size + 1` (fetch one extra to compute `has_more`). Handler does not validate cursor-matches-filters — opaque means opaque.

#### `repositories/comments.ts` (new)

```ts
export async function createComment(exec, comment: Comment): Promise<Comment>;
export async function getComment(exec, id: string): Promise<Comment>;
export async function listComments(
  exec: Client,
  taskId: string,
  filters?: { parent_id?: string | null; since?: string; until?: string },
  pagination?: PaginationInput,
): Promise<{ results: Comment[]; pagination: PaginationOutput }>;
export async function editComment(
  exec, id: string, patch: CommentPatch, now: string,
): Promise<Comment>;
// no version param — last-write-wins
export async function archiveComment(exec, id: string, now: string): Promise<Comment>;
```

Validation rules (enforced by repo or wrapper handler):
- `add_comment`: `task_id` must exist (SELECT before INSERT) → `not_found` if missing.
- `add_comment` with `parent_id`: parent comment must exist AND belong to same `task_id` → `not_found` / `conflict`.
- `add_comment` with archived `task_id`: → `conflict` ("cannot comment on archived task").

#### `repositories/events.ts` (new)

```ts
export async function appendEvent(exec, event: NewTaskEvent): Promise<TaskEvent>;
// Append-only; returns the persisted event including the assigned id (rowid).

export async function listEvents(
  exec: Client,
  taskId: string,
  filters?: { event_types?: TaskEventType[]; since?: string; until?: string },
  pagination?: PaginationInput,
): Promise<{ results: TaskEvent[]; pagination: PaginationOutput }>;
```

Sort: `ORDER BY occurred_at ASC, id ASC` (oldest-first; id tiebreaker for tied ms timestamps).

### 3.6 MCP tool layer

Lock these tool descriptions verbatim in `server.tool(name, description, shape, handler)` calls (DX analyst §A):

**Reads:**

| Tool | Description |
|---|---|
| `whoami` | "Get your bearings: project metadata, summaries of every board you can see, and hints to follow. Call this first." |
| `get_project` | "Fetch the full project record (name, description, version). Cheap; call after `whoami` if you need fields beyond the summary." |
| `list_boards` | "List board summaries with optional `archived` filter. Use `whoami` first; only call this if you need a fresh paginated view." |
| `get_board_substrate` | "Fetch a board's complete operating context in one payload: groups, field_schema, and policies. Call this once per board before doing any work on it, then cache." |
| `list_tasks` | "Query tasks with filters (board, group membership, custom_field predicates, text search, missing required fields). Returns paginated results; pass `pagination.cursor` from the previous response to continue." |
| `get_task` | "Fetch one task by id, including its current `version` (which you must echo back on `update_task`)." |
| `get_task_history` | "Fetch the TaskEvent log for a task (created, updated, archived, comment_added, …) in chronological order. Paginated." |
| `list_comments` | "List comments on a task, optionally filtered by `parent_id` (thread) or time window. Paginated." |
| `get_comment` | "Fetch one comment by id." |

**Writes:**

| Tool | Description |
|---|---|
| `create_task` | "Create a task on a board. `custom_data` is validated lazily against the board's `field_schema`. Requires `agent_name` for audit." |
| `update_task` | "Update a task's fields and/or move it between groups. Send only fields you want to change. `custom_data` merges key-by-key (`null` deletes a key). Requires `version` from your last read (returns `version_mismatch` if stale) and `agent_name`." |
| `archive_task` | "Soft-delete a task (sets `archived_at`; preserves history). Requires `version` and `agent_name`. Use `unarchive_task` to undo." |
| `unarchive_task` | "Restore a previously archived task. Requires `version` and `agent_name`." |
| `add_comment` | "Add a comment to a task. Optional `parent_id` makes it a reply. Markdown bodies allowed. Requires `agent_name`." |
| `edit_comment` | "Edit a comment's body or `custom_data`. Last-write-wins (no version). Requires `agent_name`." |
| `archive_comment` | "Soft-delete a comment. Requires `agent_name`." |

#### Riskier Zod shapes

**`update_task`:**
```ts
{
  id: z.string().min(1),
  version: z.number().int().nonnegative(),
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  custom_data: z.record(z.string(), z.unknown()).optional()
    .describe("Partial merge: only keys you send are touched. Use null to delete a key. Other keys preserved."),
  group_id: z.string().min(1).optional(),
  agent_name: z.string().min(1),
  // NO board_id — immutable per design doc
  // NO parent_id — reassignment not supported in Phase 2 (deferred)
}
```

`custom_data` merge happens in the **handler**, not the repository:
```ts
const existing = await getTask(tx, input.id);
const touched = Object.keys(input.custom_data ?? {});
const merged = { ...existing.custom_data };
for (const [k, v] of Object.entries(input.custom_data ?? {})) {
  if (v === null) delete merged[k];
  else merged[k] = v;
}
validateFieldSchema({ field_schema: board.field_schema.task, merged_custom_data: merged, touched_keys: touched });
await updateTask(tx, ...);
```

**`list_tasks`:**
```ts
{
  filters: z.object({
    board_id: z.string().min(1).optional(),
    in_groups: z.array(z.string()).optional(),
    not_in_groups: z.array(z.string()).optional(),
    parent_id: z.string().nullable().optional(),
    has_subtasks: z.boolean().optional(),
    archived: z.boolean().optional(),
    created_before: z.string().optional(),
    created_after: z.string().optional(),
    updated_before: z.string().optional(),
    updated_after: z.string().optional(),
    custom_field: z.object({
      field: z.string().min(1),
      op: z.enum(['exists','not_exists','is_empty','not_empty','eq','neq','in','not_in','gt','gte','lt','lte','contains']),
      value: z.unknown().optional(),
      values: z.array(z.unknown()).optional(),
    }).optional(),
    missing_required_fields: z.boolean().optional(),
    text_search: z.string().min(1).optional(),
  }).optional().default({}),
  sort: z.object({
    field: z.enum(['created_at','updated_at']),
    direction: z.enum(['asc','desc']),
  }).optional(),
  pagination: paginationShape.optional(),
}
```

Only one `custom_field` predicate per call — no compound `all_of`/`any_of` in Phase 2. Documented in tool description: "to combine, call twice and intersect client-side."

#### Shared pagination shape

```ts
// src/core/pagination.ts (new)
export const paginationShape = z.object({
  cursor: z.string().optional()
    .describe("Opaque token from previous response's pagination.next_cursor"),
  page_size: z.number().int().min(1).max(200).default(50)
    .describe("Max items per page. Default 50, ceiling 200."),
});

export interface PaginationOutput {
  next_cursor: string | null;
  has_more: boolean;
  page_size: number;
}
```

Every paginated tool uses this shape: `list_boards`, `list_tasks`, `get_task_history`, `list_comments`.

#### `whoami` expansion

```ts
{
  project_id: string;
  project_name: string;
  schema_version: number;
  phase: string;                // 'v0.0.2 (storage + reads + writes)'
  boards: Array<{
    id: string;
    name: string;
    description: string;
    archived_at: string | null;
    version: number;
  }>;
  hints: string[];              // [] in Phase 2; Phase 3 populates easter-egg pointer
}
```

Includes archived boards (so agents see the whole namespace). No task/group counts (drift constantly; force a fresh `list_tasks` for that).

#### `get_board_substrate` response shape

```ts
{
  board: { id, name, description, version, created_at, updated_at, archived_at },
  groups: Group[],
  field_schema: { task: ..., comments: ... },
  policies: Policy[]              // INCLUDED even with no engine — agents self-enforce
}
```

Policies are included in Phase 2 deliberately. The v1 paradigm bet is that agents reading policies modify their behavior; the engine in Phase 3 enforces. Both are valid.

#### Success envelope shape (per PRD §6)

```ts
{
  ok: true,
  applied: {
    entity: 'task' | 'comment',
    id: string,
    version: number | null,        // NULL for comments (no OCC)
    state: T,                      // full post-write entity
  },
  policies_fired: []                // empty in Phase 2; Phase 3 populates
}
```

**Envelope type change:** `applied.version` widens from `number` to `number | null`. Comments and other unversioned entities use `null`. Existing Phase 1 code (`create_task`) keeps `number` since tasks have OCC. Update `core/envelope.ts` typing; document.

#### Error message conventions

Lock these patterns (DX analyst §C):

- **`schema_violation`:** lead with what was wrong + how to fix. Example:
  `"Field 'severity' must be one of ['low','medium','high','critical'], got 'urgent'. Update custom_data.severity and retry."`
  Details: `{ field, expected, got }`.

- **`version_mismatch`:** no `current_version` in details (PRD lock). Message:
  `"This task has been updated since you last read it. Call get_task to re-read, reconcile any conflicts, then retry with the new version."`
  Details: `{ id }`.

- **`not_found`:** include the requested id + recovery tool. Example:
  `"Task '<id>' not found. It may have never existed, or been hard-deleted. Use list_tasks to see what's available."`
  Details: `{ entity, id }`.

- **`conflict`** (archived target on write): `"Task '<id>' is archived. Unarchive it before updating."` Details: `{ entity, id }`.

- **`internal_error`:** never reflect the raw error message to the agent. Log scrubbed server-side; return generic `"Internal error"`. (Phase 1 convention.)

#### `agent_name` missing — envelope, not JSON-RPC

When Zod validation fails on missing `agent_name`, the MCP SDK would naturally produce a JSON-RPC `-32602` parameter error. Phase 2 **catches `ZodError` in each tool wrapper** and reflects it as a `schema_violation` envelope so the entire write surface has one error shape:

```ts
async (input) => {
  const parsed = createTaskSchema.safeParse(input);
  if (!parsed.success) {
    const env = errorEnvelope(SubstrateError.schemaViolation(
      humanReadable(parsed.error),
      { issues: parsed.error.issues },
    ));
    return { content: [{ type: 'text', text: JSON.stringify(env) }], isError: true };
  }
  // ... handler with parsed.data
}
```

The MCP SDK still uses the Zod *shape* for `tools/list` (agents see accurate JSON schema), but at call time the handler re-parses inside the wrapper. Shared helper `wrapToolHandler(schema, handler)` lives in `src/mcp/wrapper.ts`.

### 3.7 Server-side markdown sanitizer

```ts
// src/shared/sanitize.ts (new)
import sanitizeHtml from 'isomorphic-dompurify';

export function sanitizeMarkdownHtml(html: string): string {
  // Used by Phase 3 envelope assembly when policies emit message strings
  // that may contain markdown rendering. Also used by Phase 5 UI render path.
  // Phase 2 ships the helper for forward-compat; nothing consumes it in P2.
  return sanitizeHtml.sanitize(html, { ALLOWED_ATTR: [...], FORBID_TAGS: ['script'], ...config });
}
```

Phase 2 has no markdown-render path that needs sanitization (responses carry raw markdown bodies; rendering is the UI's job in Phase 5). Ships the helper as a Phase 2 deliverable so Phase 3's `agent_responsibility` messages and Phase 5's React render both have one canonical sanitizer.

### 3.8 `ToolDeps` extension

```ts
// src/mcp/deps.ts
export interface ToolDeps {
  client: Client;
  config: Config;
  // Phase 2 adds:
  loadSubstrate: () => Promise<Substrate>;  // injected; tests substitute
}
```

Wired at the CLI command layer (`src/cli/commands/mcp.ts` already builds the `ToolDeps`). Wire:
```ts
const root = paths(cwd).root;
const deps: ToolDeps = {
  client,
  config,
  loadSubstrate: () => loadSubstrate(root),
};
```

Function injection (vs. passing `root: string`) makes test substitution clean: tests pass `loadSubstrate: async () => fixtureSubstrate`.

## 4. Tests

### Unit tests (Vitest, `src/**/*.test.ts`)

New files (one per module/repo):
- `src/storage/migrations/002-comments-events.test.ts` — applies cleanly to a fresh DB, applies cleanly on top of 001, version-stamps 2, transactional rollback on simulated failure.
- `src/storage/transaction.test.ts` (if `withTransaction` moves to a separate file; otherwise in `client.test.ts`) — commit reapplies busy_timeout; rollback reapplies; Error.cause attaches on rollback failure.
- `src/storage/repositories/tasks.test.ts` — expand: update OCC happy path, version mismatch, archive/unarchive idempotency, list_tasks every filter, pagination cursor round-trip, custom_field via JSON1, missing_required_fields requires board_id.
- `src/storage/repositories/comments.test.ts` — create/get/list, edit last-write-wins, archive idempotency, parent_id validation.
- `src/storage/repositories/events.test.ts` — append-only, listEvents pagination, event_type filter, ordering by occurred_at + id tiebreaker.
- `src/substrate/loader.test.ts` — happy path (10 boards), boards/ missing, single-file malformed (strict fail), single-file shape-mismatch.
- `src/substrate/validator.test.ts` — duplicate board IDs, duplicate group IDs, malformed field_schema, dangling group_id reference, archived-group reference allowed.
- `src/substrate/field-validator.test.ts` — type checks per FieldSchemaEntry.type, undeclared keys accepted, null deletion always allowed, required NOT enforced on write.
- `src/mcp/tools/read/*.test.ts` — one per read tool: contract snapshot + happy-path + edge cases.
- `src/mcp/tools/write/*.test.ts` — one per write tool: contract snapshot + happy-path + each documented edge case + TaskEvent emission verified by reading task_events after.

### Integration tests (Vitest `tests/integration/`)

Extend existing `tests/integration/mcp-create-task.test.ts` into a full bootstrap-flow integration:
- Init substrate
- Author a fixture board JSON file with one group and `field_schema.task.severity` enum
- whoami → assert board summary present
- get_board_substrate → assert groups + field_schema + (empty) policies
- create_task with valid severity → assert envelope + persisted row + TaskEvent('created') present
- create_task with invalid severity → assert schema_violation envelope, no task created
- update_task → version bump + TaskEvent('updated') with before/after
- update_task with stale version → version_mismatch (no current_version in details)
- archive_task / unarchive_task → idempotency + events
- add_comment + edit_comment + archive_comment → full lifecycle + events
- get_task_history → returns all events in order
- list_tasks with each filter → assert correct results

### Smoke tests (`pnpm test:smoke:concurrency`)

Update existing concurrency-worker.mjs to exercise the new write surface (currently writes via direct SQL; switch to write via the MCP tool or expand the SQL to include task_events INSERT). Re-run 60s, 4 processes, assert 0 errors AND persisted task count == reported writes AND task_events count == reported writes (each task gets exactly one `created` event).

### Real-MCP-client smoke (`tests/manual/run-smoke.mjs`)

Expand to cover the bootstrap flow: whoami → get_board_substrate → create_task → update_task → get_task_history → assert all envelope shapes match this spec.

## 5. Edge cases (consolidated)

| Scenario | Behavior |
|---|---|
| `create_task` with `board_id` that doesn't exist in substrate | `not_found` (board) |
| `create_task` with `group_id` not in board's substrate | `not_found` (group) |
| `create_task` with required field missing | **Allowed** (lazy validation per PRD §6.10) |
| `create_task` with custom_data key not in field_schema | **Allowed** (free-form per design doc) |
| `update_task` with stale version | `version_mismatch`, no `current_version` |
| `update_task` on archived task | `conflict` ("Task is archived. Unarchive first.") |
| `update_task` setting `board_id` | `schema_violation` (board_id is immutable; not in input shape) |
| `update_task` setting `parent_id` | `schema_violation` (parent_id reassignment not supported in Phase 2) |
| `update_task` with `custom_data: { foo: null }` | `foo` key deleted from custom_data |
| `archive_task` of already-archived | **Idempotent** — succeeds, no version bump, no event |
| `unarchive_task` of not-archived | **Idempotent** — succeeds, no version bump, no event |
| `add_comment` with `parent_id` from different task | `conflict` ("parent_id belongs to a different task") |
| `add_comment` on archived task | `conflict` |
| `add_comment` with `parent_id` archived | `conflict` |
| `edit_comment` concurrent edits | Both succeed; last write wins; TaskEvent `comment_edited` carries `before.body` for forensic recovery |
| `archive_comment` of already-archived | Idempotent |
| `get_task_history` filter by `event_types` | Returns only matching events |
| `list_tasks(missing_required_fields: true)` without `board_id` | `schema_violation` ("requires filters.board_id") |
| `list_tasks(text_search: 'foo')` | LIKE on title + description, case-insensitive |
| Substrate file malformed (JSON parse fail) | `internal_error` ("Malformed boards/<file>: <msg>") — strict load fails the whole substrate |
| Substrate file shape mismatch (Zod fail) | `internal_error` with Zod issues |
| Substrate policy references nonexistent group_id | `internal_error` at load time |
| Substrate policy references archived group | **Allowed** at load (engine in Phase 3 decides) |
| Substrate boards/ directory missing | Empty substrate (no boards), not an error |
| libsql busy_timeout reset after commit | `withTransaction` re-applies in `finally` |
| Migration 002 failure mid-run | Transactional rollback (inherited from Phase 1 runner) |

## 6. Open questions and resolved decisions

All ten analyst questions consolidated. Most resolved with recommended answer; the contested ones need Diego's input.

### Resolved (recommended in spec; Diego confirm)

1. **`task_events.id` type: INTEGER AUTOINCREMENT.** Diverges from design doc (`uuid`) but free monotonic ordering solves tied-ms timestamps and IDs are never externally referenced. v1 is single-machine so no cross-instance collision risk.

2. **Strict substrate loading.** One bad board file fails the whole load with a specific error pointing at the file. Aligns with Phase 1's `config.ts` strictness.

3. **Extra `custom_data` fields not in `field_schema`: accept silently.** Per design doc — `custom_data` is free-form; schema declares constraints, not the only allowed fields. Stricter would break "lazy / never reject existing data."

4. **Required-field-on-write: lazy across the board.** Per PRD §6.10 — `create_task` allows missing required fields; surfaced via `list_tasks(missing_required_fields: true)`. **Trade-off:** UX trap where agents create tasks immediately "missing required." Mitigation: tool description can mention it.

5. **Re-archive / re-unarchive: idempotent.** Succeed without version bump and without emitting an event (no state change → no event). Friendlier for agent retry logic.

6. **`parent_id` reassignment on `update_task`: not supported in Phase 2.** Field omitted from the input shape entirely. Sub-task re-parenting is a v1.x consideration; design doc doesn't address it.

7. **`board_id` reassignment: not supported.** Field omitted from `update_task` input. Cross-board move uses `fork_task` (deferred from v1) or recreate.

8. **Archived-group references in policies: validator accepts at load.** Engine in Phase 3 decides what to do at evaluation. Soft delete shouldn't retroactively invalidate substrate.

9. **`comment_edited` event carries prior body in `changes.before`.** Forensic recovery from last-write-wins data loss. Storage cost minor; only audit path.

10. **Migration runner refactor to use `withTransaction`: deferred.** Low-risk cleanup, not Phase 2 scope. The runner's current inline pattern is the gold standard that `withTransaction` should mirror exactly.

11. **`ToolDeps.loadSubstrate` shape: function injection.** `loadSubstrate: () => Promise<Substrate>` in `ToolDeps`. Function-injection wins for test substitution.

12. **`agent_name` validation error: envelope, not JSON-RPC.** Wrap each tool handler in `wrapToolHandler(schema, handler)` that catches `ZodError` and reflects as `schema_violation` envelope. One coherent error surface.

13. **Envelope `version: number | null`.** Widen `applied.version` typing. Comments get `null`; tasks keep `number`. Locked early so Phase 3+ entities can use the same pattern.

14. **`list_tasks` `custom_field`: singular only.** No compound `all_of`/`any_of`. Tool description teaches "call twice and intersect."

15. **`text_search`: LIKE on title + description, case-insensitive.** No FTS5 in v1. v1.x can swap if dogfood demands.

16. **Pagination defaults: `page_size: 50`, max `200`.** Locked in `src/core/pagination.ts` shared shape.

17. **`whoami.hints` in Phase 2: empty array.** Easter-egg hint lands in Phase 3 with the `reverse_captcha` stub. Hinting at a non-existent tool teaches agents to ignore hints — don't.

18. **`whoami.boards` includes archived.** Distinguished by `archived_at`. Agents see the whole namespace.

19. **`missing_required_fields: true` requires `filters.board_id`.** Cross-board required-fields would need scanning every board's schema. Forces a clear, board-scoped query.

20. **TaskEvent `changes` for `updated`: `{ before: Partial<Task>, after: Partial<Task> }`** with only touched fields. Phase 3 policy engine can read post-write state directly; before/after exists for audit.

### Decisions resolved (Diego confirmed recommendations 2026-05-28)

**Q1. Re-archive idempotency → NO event on idempotent re-archive.** ✅ Confirmed. Idempotent re-archive/re-unarchive succeeds, no version bump, no event. Clean event log.

**Q2. Concurrent `edit_comment` text loss → accept + audit.** ✅ Confirmed. Last-write-wins per design doc; `comment_edited` event carries `before.body` so lost text is recoverable from history. No version column on comments.

**Q3. `update_task` setting `board_id`/`parent_id` → Zod-reject as `schema_violation`.** ✅ Confirmed. Neither field appears in the `update_task` input shape; the tool wrapper surfaces a `schema_violation` envelope.

**Q4. `whoami.phase` → bump per phase.** ✅ Confirmed. Phase 2 sets `phase: 'v0.0.2 (storage + reads + writes)'`. Field is for agent introspection.

## 7. Out of scope (Phase 2)

- Policy engine (`transition_guard`, `agent_responsibility` evaluation) → Phase 3
- `reverse_captcha` stub + `whoami.hints` populated → Phase 3
- All substrate-edit tools (`create_board`, `update_board`, `archive_board`, group/policy CRUD) → Phase 4
- HTTP API mirroring MCP reads → Phase 5
- UI inspector → Phase 5
- `automation` policy class → cut from v1
- `validation` policy class → cut from v1
- Batch write tools (`create_tasks`, etc.) → cut from v1
- `fork_task` → cut from v1
- Webhook actions → cut from v1
- FTS5 / vector search → cut from v1
- Compound `custom_field` predicates → v1.x if dogfood demands
- Comment versioning / edit-CAS → v1.x consideration
- Sub-task re-parenting / cross-board task move → v1.x or v2
- Migration runner refactor to use `withTransaction` → optional v1.x cleanup

## 8. Acceptance criteria

- All v1-architecture §5 Phase 2 functional requirements implemented.
- `pnpm test` (unit + integration) green; expect ~250+ tests total (Phase 1 had 127; Phase 2 adds ~100-150).
- `pnpm test:smoke:concurrency` green at 60s with 4 processes writing via the new MCP tools (or direct SQL with TaskEvent emission); persisted task count == reported writes AND persisted task_events count == reported writes.
- `pnpm exec tsc --noEmit` clean for both root and ui (ui unchanged in Phase 2).
- `pnpm exec eslint .` and `pnpm exec prettier --check .` clean.
- `pnpm build` clean.
- **Real-MCP-client smoke (`node tests/manual/run-smoke.mjs`)** passes the full bootstrap flow described in §4.
- `withTransaction` used by every write tool — verified by Code Reviewer; no write tool emits a TaskEvent outside its parent transaction.
- Every error envelope from a write tool follows the conventions in §3.6 — verified by integration test assertions.
- Bootstrap flow from §H of DX analyst report works end-to-end against a SampleSaaS fixture board.

## 9. Definition of Done (for this spec)

This spec is approved by Diego when:
- The 4 open questions in §6 (re-archive event emission, comment edit-loss policy, update_task field rejection, phase string convention) are resolved.
- The 20 recommended decisions in §6 are either confirmed or replaced with alternatives.
- The acceptance criteria §8 are agreed.

Then per workflow.md Stage 2: Architect drafts Phase 2 plan → Architect Reviewer reviews → revision → Diego approves plan → development begins.
