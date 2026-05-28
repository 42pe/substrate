import type { Transaction } from '@libsql/client';
import type { Migration } from './runner.js';

/**
 * Migration 002 — comments + task_events tables.
 *
 * Per Phase 2 spec §3.1. Adds the two tables Phase 2 needs beyond the
 * Phase 1 `tasks` table:
 *   - `comments`     — threaded comments on tasks (append-only / LWW edits,
 *                      no version column per design doc §Concurrency)
 *   - `task_events`  — append-only audit + change feed. `id` is INTEGER
 *                      AUTOINCREMENT (not uuid) for free monotonic ordering
 *                      of tied-millisecond timestamps; v1 is single-machine
 *                      so there's no cross-instance id-collision concern.
 *
 * No FOREIGN KEY clauses — libsql requires `PRAGMA foreign_keys = ON` per
 * connection to enforce, which we don't set. App-layer validation only,
 * matching the Phase 1 stance on `tasks`.
 *
 * Does NOT set `PRAGMA user_version`. The runner stamps it (to 2)
 * immediately after `up()` within the same transaction.
 */
export const migration002: Migration = {
  id: 2,
  description: 'Add comments and task_events tables',
  async up(tx: Transaction): Promise<void> {
    await tx.execute(`
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
      )
    `);
    await tx.execute('CREATE INDEX idx_comments_task_id ON comments(task_id)');
    await tx.execute('CREATE INDEX idx_comments_parent_id ON comments(parent_id)');
    await tx.execute('CREATE INDEX idx_comments_archived_at ON comments(archived_at)');

    await tx.execute(`
      CREATE TABLE task_events (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id           TEXT NOT NULL,
        event_type        TEXT NOT NULL,
        changes           TEXT NOT NULL DEFAULT '{}',
        actor_agent_name  TEXT NOT NULL,
        occurred_at       TEXT NOT NULL
      )
    `);
    await tx.execute('CREATE INDEX idx_task_events_task_id ON task_events(task_id)');
    await tx.execute('CREATE INDEX idx_task_events_occurred_at ON task_events(occurred_at)');
    await tx.execute(
      'CREATE INDEX idx_task_events_task_id_occurred_at ON task_events(task_id, occurred_at)',
    );
    await tx.execute('CREATE INDEX idx_task_events_event_type ON task_events(event_type)');
  },
};
