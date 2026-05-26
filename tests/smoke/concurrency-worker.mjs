// Concurrency smoke worker. Run via spawn from the test runner.
// Args: <dbPath> <role> <durationMs>
//
// Opens a libsql client against the shared data.sqlite and writes rows
// in a loop until durationMs elapses. Each row exercises the same code
// path as MCP's create_task (INSERT into tasks via parameterized query).
// On exit, prints a single line of JSON with the role, pid, writeCount,
// errorCount, and any error code map.

import { createClient } from '@libsql/client';
import { randomUUID } from 'node:crypto';

const dbPath = process.argv[2];
const role = process.argv[3] ?? 'unknown';
const durationMs = Number(process.argv[4] ?? 60000);
const writeIntervalMs = 25;

if (!dbPath) {
  process.stderr.write('Usage: concurrency-worker.mjs <dbPath> <role> <durationMs>\n');
  process.exit(2);
}

const client = createClient({ url: `file:${dbPath}` });

// Substrate convention: every connection sets busy_timeout. Schema is
// already created by the test's setup phase (initCommand), so workers
// don't run migrations themselves.
await client.execute('PRAGMA busy_timeout = 5000');

let writeCount = 0;
let errorCount = 0;
const errorsByCode = new Map();
const start = Date.now();
const now = () => new Date().toISOString();

while (Date.now() - start < durationMs) {
  try {
    const id = randomUUID();
    await client.execute({
      sql: `
        INSERT INTO tasks (
          id, board_id, group_id, parent_id, origin_task_id,
          title, description, custom_data, version,
          created_by_agent, created_at, updated_at, archived_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        id,
        'smoke-board',
        'smoke-group',
        null,
        null,
        `${role} task ${writeCount + 1}`,
        '',
        '{}',
        1,
        role,
        now(),
        now(),
        null,
      ],
    });
    writeCount += 1;
  } catch (e) {
    errorCount += 1;
    const key = e?.code || e?.message?.slice(0, 80) || 'unknown';
    errorsByCode.set(key, (errorsByCode.get(key) || 0) + 1);
  }
  await new Promise((r) => setTimeout(r, writeIntervalMs));
}

process.stdout.write(
  `${JSON.stringify({
    role,
    pid: process.pid,
    durationMs,
    writeCount,
    errorCount,
    errors: Object.fromEntries(errorsByCode),
  })}\n`,
);

client.close?.();
