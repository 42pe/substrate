import { describe, it, expect } from 'vitest';
import { rmrf } from '../helpers/tmp.js';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { initCommand } from '../../src/cli/commands/init.js';

interface WorkerResult {
  role: string;
  pid: number;
  durationMs: number;
  writeCount: number;
  errorCount: number;
  errors: Record<string, number>;
  exitCode: number | null;
  rawTail?: string;
}

const WORKER_PATH = resolve(import.meta.dirname, 'concurrency-worker.mjs');

function spawnWorker(dbPath: string, role: string, durationMs: number): Promise<WorkerResult> {
  return new Promise((resolveFn) => {
    const child: ChildProcess = spawn('node', [WORKER_PATH, dbPath, role, String(durationMs)], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });

    let stdoutBuf = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString('utf-8');
    });

    child.on('exit', (code) => {
      const lines = stdoutBuf.trim().split('\n').filter(Boolean);
      const lastLine = lines[lines.length - 1] ?? '';
      try {
        const parsed = JSON.parse(lastLine) as Omit<WorkerResult, 'exitCode'>;
        resolveFn({ ...parsed, exitCode: code });
      } catch {
        resolveFn({
          role,
          pid: child.pid ?? -1,
          durationMs,
          writeCount: 0,
          errorCount: 0,
          errors: {},
          exitCode: code,
          rawTail: stdoutBuf.slice(-500),
        });
      }
    });
  });
}

/**
 * Phase 1 / Step 9 — concurrency smoke.
 *
 * Re-validates the Phase 0 spike finding ("libsql native + WAL handles
 * multi-process concurrent writes cleanly") against the Phase 1 schema
 * + migration paths. 4 worker processes write rows concurrently for the
 * configured duration; we assert zero errors and that the persisted
 * count matches the reported count exactly (no silent drops).
 *
 * Duration: 60s per spec, matches the Phase 0 spike. Vitest's default
 * test timeout is 5s, so we use a generous timeout below. Run via
 * `pnpm test:smoke:concurrency` only — excluded from `pnpm test` because
 * 60s is long for a default test run.
 */
describe('concurrency smoke', () => {
  it('4 processes writing for 60s → 0 errors, persisted count matches reported', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'substrate-smoke-conc-'));
    try {
      // Test bootstraps the schema (one-time, no race) via initCommand.
      // Workers then open with just busy_timeout — matches the Phase 0
      // spike pattern that proved clean behavior.
      await initCommand(cwd);
      const dbPath = join(cwd, '.substrate', 'data.sqlite');

      const durationMs = 60_000;
      const workers = ['worker-0', 'worker-1', 'worker-2', 'worker-3'];

      const results = await Promise.all(workers.map((r) => spawnWorker(dbPath, r, durationMs)));

      // Per-worker assertions
      for (const r of results) {
        expect(r.exitCode, `${r.role} exit code`).toBe(0);
        expect(r.errorCount, `${r.role} errors: ${JSON.stringify(r.errors)}`).toBe(0);
        expect(r.writeCount, `${r.role} writes`).toBeGreaterThan(0);
      }

      const reportedTotal = results.reduce((s, r) => s + r.writeCount, 0);

      // Verify persisted count matches reported count exactly — no silent
      // drops, no double-counts. Open a fresh client for the read.
      const { createClient } = await import('@libsql/client');
      const dbClient = createClient({ url: `file:${dbPath}` });
      try {
        const countResult = await dbClient.execute('SELECT COUNT(*) AS n FROM tasks');
        const row = countResult.rows[0] as Record<string, unknown>;
        const persistedCount =
          typeof row['n'] === 'bigint' ? Number(row['n']) : (row['n'] as number);
        expect(persistedCount).toBe(reportedTotal);

        // Each write also emits a `created` task_event in the same transaction.
        // The event count must match exactly — proves atomicity under
        // concurrency (no task without its audit entry, no orphan event).
        const eventResult = await dbClient.execute(
          "SELECT COUNT(*) AS n FROM task_events WHERE event_type = 'created'",
        );
        const erow = eventResult.rows[0] as Record<string, unknown>;
        const eventCount =
          typeof erow['n'] === 'bigint' ? Number(erow['n']) : (erow['n'] as number);
        expect(eventCount).toBe(reportedTotal);
      } finally {
        dbClient.close();
      }

      console.log(
        `[concurrency smoke] PASS — ${results.length} workers, ${reportedTotal} writes, 0 errors`,
      );
    } finally {
      await rmrf(cwd);
    }
  }, 90_000); // 60s test + 30s margin
});
