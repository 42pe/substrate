/**
 * Core entity types for Substrate.
 *
 * Phase 1 ships only Task + Config. Comment, TaskEvent, Board, Group, Policy
 * land in later phases (per v1-architecture plan):
 *   - Comment, TaskEvent          → Phase 2
 *   - Board, Group                → Phase 2 (substrate JSON loading)
 *   - Policy                      → Phase 3 (policy engine)
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
