import type { Client, Transaction } from '@libsql/client';

type Executor = Client | Transaction;

/**
 * Migration 001 — initial schema.
 *
 * Creates the `tasks` table per PRD §6.1 and Phase 1 spec §3.6. Indexes on
 * board_id, group_id, parent_id, archived_at to support Phase 2's list_tasks
 * filters efficiently.
 *
 * Phase 1 ships only the `tasks` table; comments / task_events / etc. land
 * with later migrations.
 *
 * Important: this migration does NOT set `PRAGMA user_version`. The runner
 * (src/storage/migrations/runner.ts) is the sole place that stamps the
 * version, immediately after `up()` completes within the same transaction.
 */
export const migration001 = {
  id: 1,
  description: 'Initial schema: tasks table',
  async up(tx: Executor): Promise<void> {
    await tx.execute(`
      CREATE TABLE tasks (
        id                TEXT PRIMARY KEY,
        board_id          TEXT NOT NULL,
        group_id          TEXT NOT NULL,
        parent_id         TEXT,
        origin_task_id    TEXT,
        title             TEXT NOT NULL,
        description       TEXT NOT NULL DEFAULT '',
        custom_data       TEXT NOT NULL DEFAULT '{}',
        version           INTEGER NOT NULL DEFAULT 1,
        created_by_agent  TEXT NOT NULL,
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL,
        archived_at       TEXT
      )
    `);
    await tx.execute('CREATE INDEX idx_tasks_board_id ON tasks(board_id)');
    await tx.execute('CREATE INDEX idx_tasks_group_id ON tasks(group_id)');
    await tx.execute('CREATE INDEX idx_tasks_parent_id ON tasks(parent_id)');
    await tx.execute('CREATE INDEX idx_tasks_archived_at ON tasks(archived_at)');
  },
};
