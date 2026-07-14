/**
 * Core entity types for Substrate.
 *
 * Phase 1 shipped Task + Config. Phase 2 adds Comment, TaskEvent, and the
 * substrate-JSON entities (Board, Group, Policy, FieldSchema, Substrate).
 * Policy carries a structural type in Phase 2; the engine that evaluates
 * `definition` lands in Phase 3.
 *
 * Field shapes are derived from the design doc §Entities, with adjustments
 * per the local-first pivot (no User, no Token; created_by_token removed).
 */

/**
 * The implicit single project per Substrate instance. Lives in
 * `.substrate/config.json`.
 */
export interface Config {
  /** UUID-v4 generated at `substrate init`. */
  project_id: string;
  /** Defaults to the cwd basename at init; user-editable. */
  project_name: string;
  /** Free-form project description (Phase 4; `update_project`-editable). */
  description: string;
  /** OCC counter for `update_project` (Phase 4). Starts at 1. */
  version: number;
  /** Matches `BINARY_SCHEMA_VERSION` at init time. */
  schema_version: number;
  /** ISO-8601 UTC. */
  created_at: string;
}

/**
 * Phase 1 Task shape (mirrors migration 001 schema).
 *
 * `custom_data` is the parsed JSON value (not the storage string). The
 * repository layer is responsible for JSON parse/stringify at the SQLite
 * boundary.
 */
export interface Task {
  /** UUID. */
  id: string;
  /** FK Board id. Immutable after creation. Phase 1: unenforced. */
  board_id: string;
  /** FK Group id. Phase 1: unenforced. */
  group_id: string;
  /** Subtask parent. */
  parent_id: string | null;
  /** Set when this task was forked from another. */
  origin_task_id: string | null;
  title: string;
  /** Markdown. */
  description: string;
  /** Validated against board.field_schema.task in Phase 2. */
  custom_data: Record<string, unknown>;
  /** Monotonic OCC counter. */
  version: number;
  /** Free-form audit-tag string; not authenticated. */
  created_by_agent: string;
  /** ISO-8601 UTC. */
  created_at: string;
  /** ISO-8601 UTC. */
  updated_at: string;
  /** Soft delete; ISO-8601 UTC. */
  archived_at: string | null;
}

/**
 * Lean projection of a Task for `list_tasks` (default `view: 'summary'`). Drops
 * the two heavy fields — `description` (markdown body) and the bulky parts of
 * `custom_data` — so a list response stays small enough for an agent's context.
 * `get_task` (and `list_tasks` with `view: 'full'`) return the full `Task`.
 *
 * See `core/task-summary.ts` for the projection. Filtering is unaffected:
 * `custom_field` predicates run in SQL against the full row, not this view.
 */
export interface TaskSummary {
  id: string;
  board_id: string;
  group_id: string;
  parent_id: string | null;
  origin_task_id: string | null;
  title: string;
  /** First ~200 graphemes of `description`, word-trimmed, `…` if cut; `''` if none. */
  description_excerpt: string;
  /** True when the excerpt is shorter than the full description (call `get_task`). */
  description_truncated: boolean;
  /** Trimmed `custom_data`: only `boolean | number | null | string(≤120)` values. */
  custom_data: Record<string, unknown>;
  /** Keys dropped from `custom_data` (long string / array / object) — in `get_task`. */
  custom_data_omitted: string[];
  version: number;
  created_by_agent: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

/**
 * Comment on a task. Threaded via `parent_id`. Append-only with
 * last-write-wins on edits — NO version column (design doc §Concurrency).
 */
export interface Comment {
  id: string;
  task_id: string;
  /** Nested reply; null for a thread-root comment. */
  parent_id: string | null;
  /** Markdown. */
  body: string;
  /** Validated against board.field_schema.comments. */
  custom_data: Record<string, unknown>;
  created_by_agent: string;
  created_at: string;
  /** Set on edit_comment; null if never edited. */
  edited_at: string | null;
  archived_at: string | null;
}

/**
 * TaskEvent event types for v1. No `automation_executed` (no automation
 * class in v1) and no `forked` (no fork_task tool in v1).
 */
export type TaskEventType =
  | 'created'
  | 'updated'
  | 'archived'
  | 'unarchived'
  | 'comment_added'
  | 'comment_edited'
  | 'comment_archived'
  // A transition_guard blocked a group move. Recorded even though the move
  // rolls back, so a human sees enforcement that otherwise left no trace. The
  // `created`/`updated` events carry a `policies_fired` entry for policies that
  // engaged on a successful write — there is no separate event for those.
  | 'move_blocked';

/**
 * Append-only change log + audit entry. `id` is an INTEGER rowid (not a
 * uuid) so chronological ordering is free even when `occurred_at`
 * timestamps tie at millisecond resolution. `changes` shape varies by
 * `event_type` (see Phase 2 spec §3.2).
 */
export interface TaskEvent {
  id: number;
  task_id: string;
  event_type: TaskEventType;
  changes: Record<string, unknown>;
  actor_agent_name: string;
  occurred_at: string;
}

/**
 * One field declaration in a board's field_schema. `format` is
 * informational in v1 (not enforced). `values` is required when
 * `type === 'enum'`.
 */
export interface FieldSchemaEntry {
  type: 'string' | 'number' | 'boolean' | 'enum' | 'markdown' | 'string_list';
  required?: boolean;
  format?: string;
  values?: string[];
  /** B3: agent MCP write tools refuse to set this field; only a human channel
   *  (`substrate approve` / the UI) may. Makes a guard requiring it a real gate. */
  human_only?: boolean;
}

/**
 * Per-board declaration of the custom_data fields tasks and comments may
 * carry. Comment fields are flat (no per-type sub-schemas).
 */
export interface FieldSchema {
  task: Record<string, FieldSchemaEntry>;
  comments: Record<string, FieldSchemaEntry>;
}

/**
 * A category within a board. Tasks belong to one group. Meaning is per-board
 * (status / owner / category / time period). Lives nested in boards/<id>.json.
 */
export interface Group {
  id: string;
  name: string;
  description: string;
  position: number;
  color: string | null;
  version: number;
  archived_at: string | null;
}

/**
 * A rule attached to a board. v1 ships two classes. The `definition` JSON
 * is structural-only in Phase 2 (engine evaluates it in Phase 3).
 */
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

/**
 * A project-level team member (a persona/role identity), defined once in the
 * registry at `.substrate/members/<id>.json` and referenced by any number of
 * boards via a `TeamBinding`. A member is DESCRIPTIVE metadata only — it never
 * gates a write or a transition, and Substrate never reads `memory_dir`.
 *
 * A member is NOT an actor: the free-form `created_by_agent` / `agent_name`
 * audit tag on a write records *who performed a mutation*; a member answers
 * *who is this role?*. The two are intentionally kept separate (see the spec).
 *
 * Integrity problems (a dangling reference, a duplicate id, even a malformed
 * member file) are non-blocking warnings — the whole member layer is optional
 * and additive, so breaking it must never break a project that keeps its roster
 * in board `description` prose. (Substrate's OWN shipped default template stays
 * strictly validated — see `loadTemplateBoard` / `loadTemplateMembers`.)
 */
export interface Member {
  /** Unique across the registry; matches the filename (`<id>.json`). */
  id: string;
  /** Display name. */
  name: string;
  /** Prose role brief — complements (does not replace) traits/concerns. */
  full_description?: string;
  /** Short descriptors (chips / query). */
  traits?: string[];
  /** What the member watches for. */
  concerns?: string[];
  /** Path to a git-committed memory folder — a POINTER only; Substrate never
   *  reads its content (default convention `.substrate/members/<id>/memory`). */
  memory_dir?: string;
}

/**
 * A board's reference to a registry `Member`, plus the one thing that is
 * genuinely board-specific: the group(s) the member is associated with ON THIS
 * board. Lives nested in a board's `team`.
 */
export interface TeamBinding {
  /** → `Member.id` in the registry. An unresolved reference is a warning, not an error. */
  member: string;
  /** Group ids this member targets ON THIS board. ADVISORY — a hint for
   *  orchestration and UI, never a permission and never enforced. `[]` / omitted
   *  = the member spans the board (no dedicated group). Many-to-many. */
  groups?: string[];
}

/**
 * A board, as parsed from `.substrate/boards/<board_id>.json`. Groups,
 * field_schema, and policies are nested inline (PRD §6.2). Boards are NOT
 * stored in SQLite — they are substrate-as-code.
 */
export interface Board {
  id: string;
  name: string;
  description: string;
  field_schema: FieldSchema;
  groups: Group[];
  policies: Policy[];
  /** Optional per-board team: references to registry members + advisory group
   *  associations. Absent on older boards and boards that keep their roster in
   *  prose — they still parse. Never gates anything. */
  team?: TeamBinding[];
  version: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

/**
 * The whole substrate read once per MCP call: the implicit project config,
 * every board parsed from `.substrate/boards/*.json`, and the project-level
 * member registry from `.substrate/members/*.json`.
 */
export interface Substrate {
  config: Config;
  boards: Board[];
  /** The project-level member registry. Empty when there is no `members/`
   *  directory. Malformed member files are warned-and-skipped, never fatal. */
  members: Member[];
  /** Non-blocking advisory diagnostics accumulated while loading + validating
   *  (malformed member files, dangling member/group references, duplicates).
   *  Surfaced by `substrate validate` / `diagnose`; never fails a load. */
  warnings: string[];
}
