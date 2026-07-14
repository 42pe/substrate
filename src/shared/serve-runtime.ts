import { existsSync, unlinkSync } from 'node:fs';
import { readFile, writeFile, unlink } from 'node:fs/promises';

/**
 * Per-project runtime record for a live `substrate serve`, written next to the
 * PID file at `.substrate/serve.json`. It records the port serve actually bound
 * (which may differ from `DEFAULT_PORT` when the free-port fallback kicked in)
 * so `diagnose` and the operator can answer "which port is this project on?"
 * without `lsof`.
 *
 * This is a discovery record, NOT the ownership lock — `.substrate/substrate.pid`
 * remains the single-owner-per-directory guard (exclusive-create). serve.json is
 * additive: it's written after a successful bind and cleared on every teardown
 * path. Gitignored and regenerated each serve, like the PID file.
 */
export interface ServeRuntime {
  readonly pid: number;
  readonly port: number;
  readonly started_at: string;
}

/**
 * Read + parse the runtime record. Returns null when the file is absent or
 * unparseable/malformed — a stale or corrupt record is treated as "no record"
 * rather than a hard error (callers gate on `isProcessAlive(pid)` anyway).
 */
export async function readServeRuntime(runtimePath: string): Promise<ServeRuntime | null> {
  if (!existsSync(runtimePath)) return null;
  try {
    const parsed: unknown = JSON.parse(await readFile(runtimePath, 'utf-8'));
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as ServeRuntime).pid === 'number' &&
      typeof (parsed as ServeRuntime).port === 'number' &&
      typeof (parsed as ServeRuntime).started_at === 'string'
    ) {
      return parsed as ServeRuntime;
    }
    return null;
  } catch {
    return null;
  }
}

/** Write the runtime record (last-write-wins; not a lock). */
export async function writeServeRuntime(runtimePath: string, record: ServeRuntime): Promise<void> {
  await writeFile(runtimePath, `${JSON.stringify(record, null, 2)}\n`, 'utf-8');
}

/** Best-effort async removal of the runtime record. Never throws. */
export async function clearServeRuntime(runtimePath: string): Promise<void> {
  await unlink(runtimePath).catch(() => undefined);
}

/** Best-effort synchronous removal (for `beforeExit`, which can't await). */
export function clearServeRuntimeSync(runtimePath: string): void {
  try {
    if (existsSync(runtimePath)) unlinkSync(runtimePath);
  } catch {
    // best-effort
  }
}
