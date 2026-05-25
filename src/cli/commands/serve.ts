import { existsSync } from 'node:fs';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { paths, substrateRootFromCwd } from '../../shared/paths.js';
import { readConfig } from '../../shared/config.js';
import { openDatabaseAndMigrate } from '../../storage/client.js';
import {
  createApp,
  defaultHttpConfig,
  startHttpServer,
  DEFAULT_PORT,
  type HttpConfig,
} from '../../http/server.js';
import { SubstrateError } from '../../core/errors.js';
import { logger } from '../../shared/logger.js';

/**
 * `npx substrate serve` — start the HTTP UI server.
 *
 * Behavior (per Phase 1 spec §3.2):
 *   1. Refuse if `.substrate/` is missing.
 *   2. PID file dance: if present and the PID is alive, refuse; if dead,
 *      reclaim. Write our PID after binding the port.
 *   3. Open the database (which runs migrations + verifies schema_version).
 *   4. Bind Hono to 127.0.0.1:7475. Refuse on EADDRINUSE.
 *   5. Install SIGINT/SIGTERM handlers: clean shutdown of server + DB +
 *      PID file, exit 0.
 *
 * `SUBSTRATE_PORT_OVERRIDE` env var allows tests to pick a free port.
 * Not documented as a user feature; remove or hide in v1.x.
 */
export async function serveCommand(cwd: string): Promise<void> {
  const root = substrateRootFromCwd(cwd);
  if (!existsSync(root)) {
    throw SubstrateError.notFound(`No .substrate/ in ${cwd}. Run 'substrate init' first.`, { cwd });
  }

  const p = paths(root);
  const config = await readConfig(root);

  // PID file check + reclaim
  if (existsSync(p.pid)) {
    const pidStr = await readFile(p.pid, 'utf-8');
    const pid = parseInt(pidStr.trim(), 10);
    if (!Number.isNaN(pid) && isProcessAlive(pid)) {
      throw SubstrateError.conflict(
        `Substrate is already running here (pid ${pid}). Stop it first ` +
          `or remove the stale PID file at ${p.pid}.`,
        { pid, pid_file: p.pid },
      );
    }
    // PID file exists but process is dead — reclaim
    await unlink(p.pid).catch(() => undefined);
  }

  // Open the database (runs migrations, verifies schema version)
  const client = await openDatabaseAndMigrate(p.dataSqlite);

  // Resolve port. SUBSTRATE_PORT_OVERRIDE is test-only.
  const portRaw = process.env['SUBSTRATE_PORT_OVERRIDE'];
  const port = portRaw ? parseInt(portRaw, 10) : DEFAULT_PORT;

  const httpConfig: HttpConfig = {
    ...defaultHttpConfig(cwd),
    port,
    allowedOrigins: [`http://localhost:${port}`, `http://127.0.0.1:${port}`],
    allowedHosts: [`localhost:${port}`, `127.0.0.1:${port}`],
  };
  const app = createApp(httpConfig);

  let server: ReturnType<typeof startHttpServer>;
  try {
    server = startHttpServer(app, port);
  } catch (e) {
    client.close();
    if ((e as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      throw SubstrateError.conflict(
        `Port ${port} is already in use. Another process holds it. ` +
          `Stop that process or change the port.`,
        { port },
      );
    }
    throw e;
  }

  // Write PID file AFTER successful bind
  await writeFile(p.pid, String(process.pid), 'utf-8');

  logger.info(`Substrate running on http://localhost:${port}`, {
    pid: process.pid,
    project_name: config.project_name,
  });

  // Shutdown handler — idempotent
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Received ${signal}, shutting down`);
    server.close();
    client.close();
    await unlink(p.pid).catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  // Wait forever; the shutdown handler will exit.
  await new Promise<void>(() => undefined);
}

/**
 * Returns true if a process with the given PID is alive. Uses
 * `process.kill(pid, 0)` which sends no signal but throws if the target
 * doesn't exist (ESRCH) or we lack permission (EPERM — treat as alive,
 * conservative).
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EPERM') return true; // exists but we can't signal
    return false; // ESRCH or anything else: assume dead
  }
}
