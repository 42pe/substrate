/**
 * Phase 5b UI smoke fixture (run via `tsx`, so it can import repo source with
 * the NodeNext `.js` specifiers the Playwright loader would choke on).
 *
 * Usage: `tsx tests/smoke/ui-seed-and-serve.ts <cwd> <port>`
 *
 * Seeds a `.substrate/` in <cwd> (init → board file → tasks → comment →
 * event) and then runs `substrate serve` on <port>. The caller (ui.spec.ts)
 * is responsible for copying the real `dist/ui` build into <cwd>/dist/ui so
 * the static route serves the actual app, not the placeholder. The process
 * blocks in `serveCommand` until SIGTERM, then shuts down cleanly.
 */
import { initCommand } from '../../src/cli/commands/init.js';
import { serveCommand } from '../../src/cli/commands/serve.js';
import { substrateRootFromCwd, paths } from '../../src/shared/paths.js';
import { createBoardFile } from '../../src/substrate/writer.js';
import { openDatabaseAndMigrate } from '../../src/storage/client.js';
import { createTask } from '../../src/storage/repositories/tasks.js';
import { createComment } from '../../src/storage/repositories/comments.js';
import { appendEvent } from '../../src/storage/repositories/events.js';
import type { Board, Task, Comment } from '../../src/core/types.js';

const [cwd, portStr] = process.argv.slice(2);
if (!cwd || !portStr) {
  console.error('usage: ui-seed-and-serve.ts <cwd> <port>');
  process.exit(2);
}

const now = '2026-05-09T00:00:00.000Z';

const board: Board = {
  id: 'main',
  name: 'Roadmap',
  description: 'The **primary** board. Tracks delivery.',
  field_schema: {
    task: { priority: { type: 'enum', values: ['low', 'high'], required: false } },
    comments: {},
  },
  groups: [
    {
      id: 'todo',
      name: 'To do',
      description: '',
      position: 0,
      color: null,
      version: 1,
      archived_at: null,
    },
    {
      id: 'done',
      name: 'Done',
      description: '',
      position: 1,
      color: null,
      version: 1,
      archived_at: null,
    },
  ],
  policies: [
    {
      id: 'p1',
      name: 'No skipping review',
      description: 'Tasks must pass through _review_ before Done.',
      type: 'transition_guard',
      definition: {},
      priority: 0,
      enabled: true,
      version: 1,
      created_by_agent: 'seed',
      created_at: now,
      updated_at: now,
      archived_at: null,
    },
  ],
  version: 1,
  created_at: now,
  updated_at: now,
  archived_at: null,
};

function makeTask(id: string, group: string, title: string): Task {
  return {
    id,
    board_id: 'main',
    group_id: group,
    parent_id: null,
    origin_task_id: null,
    title,
    description: `Task **${title}** description with a [link](https://example.com).`,
    custom_data: { priority: 'high' },
    version: 1,
    created_by_agent: 'seed',
    created_at: now,
    updated_at: now,
    archived_at: null,
  };
}

const comment: Comment = {
  id: 'c1',
  task_id: 't1',
  parent_id: null,
  body: 'First **comment** with `code`.',
  custom_data: {},
  created_by_agent: 'seed',
  created_at: now,
  edited_at: null,
  archived_at: null,
};

async function main(cwd: string, portStr: string): Promise<void> {
  await initCommand(cwd);
  const root = substrateRootFromCwd(cwd);
  await createBoardFile(root, board);

  const client = await openDatabaseAndMigrate(paths(root).dataSqlite);
  await createTask(client, makeTask('t1', 'todo', 'Design'));
  await createTask(client, makeTask('t2', 'done', 'Ship'));
  await createComment(client, comment);
  await appendEvent(client, {
    task_id: 't1',
    event_type: 'created',
    changes: {},
    actor_agent_name: 'seed',
    occurred_at: now,
  });
  client.close();

  process.env['SUBSTRATE_PORT_OVERRIDE'] = portStr;
  await serveCommand(cwd); // blocks until SIGTERM
}

main(cwd, portStr).catch((err: unknown) => {
  console.error('seed-and-serve failed:', err);
  process.exit(1);
});
