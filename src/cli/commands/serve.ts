import { existsSync, unlinkSync } from 'node:fs';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { paths, substrateRootFromCwd } from '../../shared/paths.js';
import { readConfig } from '../../shared/config.js';
import { openDatabaseAndMigrate } from '../../storage/client.js';
import { loadSubstrate } from '../../substrate/loader.js';
import {
  createApp,
  defaultHttpConfig,
  startHttpServer,
  closeHttpServer,
  DEFAULT_PORT,
  type HttpConfig,
} from '../../http/server.js';
import { SubstrateError } from '../../core/errors.js';
import { logger } from '../../shared/logger.js';
import { isProcessAlive, identifyPortHolder } from '../../shared/process.js';

/**
 * `npx substrate serve` — start the HTTP UI server.
 *
 * Behavior (per Phase 1 spec §3.2):
 *   1. Refuse if `.substrate/` is missing.
 *   2. PID file dance: if present and the PID is alive, refuse; if dead,
 *      reclaim. Write our PID after binding the port via exclusive-create
 *      (O_EXCL) so a race between two near-simultaneous serves is caught.
 *      Reviewer C-4 fix.
 *   3. Open the database (which runs migrations + verifies schema_version).
 *   4. Bind Hono to 127.0.0.1:7475. EADDRINUSE is caught via the underlying
 *      server's async `'error'` event (Reviewer B-1 fix).
 *   5. Install SIGINT/SIGTERM handlers: clean shutdown awaits server.close()
 *      and client.close() before process.exit(0). Reviewer C-2 + C-3 fix.
 *
 * `SUBSTRATE_PORT_OVERRIDE` env var allows tests to pick a free port.
 * Not documented as a user feature; v1.x: remove. Reviewer S-6 fix added
 * integer validation so a typo'd value fails loudly instead of binding NaN.
 */
export async function serveCommand(cwd: string): Promise<void> {
  const root = substrateRootFromCwd(cwd);
  if (!existsSync(root)) {
    throw SubstrateError.notFound(`No .substrate/ in ${cwd}. Run 'substrate init' first.`, { cwd });
  }

  const p = paths(root);
  const config = await readConfig(root);

  // PID file check + reclaim. There's a TOCTOU window between this check
  // and the exclusive-create write below — the writeFile({flag:'wx'})
  // is the actual deterministic guard.
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

  // Resolve port. SUBSTRATE_PORT_OVERRIDE is test-only; validate it's
  // actually a positive integer so a typo'd `SUBSTRATE_PORT_OVERRIDE=foo`
  // fails with a clear error instead of binding NaN.
  const portRaw = process.env['SUBSTRATE_PORT_OVERRIDE'];
  let port = DEFAULT_PORT;
  if (portRaw !== undefined) {
    const parsed = parseInt(portRaw, 10);
    if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
      client.close();
      throw SubstrateError.internalError(
        `SUBSTRATE_PORT_OVERRIDE must be a positive integer 1..65535, got ${JSON.stringify(portRaw)}`,
      );
    }
    port = parsed;
  }

  const httpConfig: HttpConfig = {
    ...defaultHttpConfig(cwd),
    port,
    allowedOrigins: [`http://localhost:${port}`, `http://127.0.0.1:${port}`],
    allowedHosts: [`localhost:${port}`, `127.0.0.1:${port}`],
    // Read API deps (Phase 5a): reuses the client serve already opened. No
    // `root` — the HTTP surface is reads-only.
    apiDeps: { client, config, loadSubstrate: () => loadSubstrate(root) },
  };
  const app = createApp(httpConfig);

  let server: Awaited<ReturnType<typeof startHttpServer>>;
  try {
    server = await startHttpServer(app, port);
  } catch (e) {
    client.close();
    if ((e as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      const holder = await identifyPortHolder(port);
      throw SubstrateError.conflict(
        `Port ${port} is already in use${holder ? ` by ${holder}` : ''}. ` +
          `Stop that process or change the port.`,
        { port, ...(holder ? { holder } : {}) },
      );
    }
    throw e;
  }

  // Write PID file AFTER successful bind, using exclusive-create.
  // If a race got us here with another live serve, this throws EEXIST.
  try {
    await writeFile(p.pid, String(process.pid), { encoding: 'utf-8', flag: 'wx' });
  } catch (e) {
    await closeHttpServer(server);
    client.close();
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
      throw SubstrateError.conflict(
        `Another Substrate process raced us and wrote the PID file at ${p.pid}. ` +
          `That process owns this directory. Stop it first.`,
        { pid_file: p.pid },
      );
    }
    throw e;
  }

  logger.info(`Substrate running on http://localhost:${port}`, {
    pid: process.pid,
    project_name: config.project_name,
  });

  // Shutdown handler — idempotent. Reviewer C-2 + C-3 fix: actually awaits
  // server.close() + client.close(); on any unexpected error inside the
  // handler, force-exits with code 1 rather than hanging.
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      logger.info(`Received ${signal}, shutting down`);
      await closeHttpServer(server);
      client.close();
      await unlink(p.pid).catch(() => undefined);
      process.exit(0);
    } catch (err) {
      logger.error('Error during shutdown', { error: (err as Error).message });
      process.exit(1);
    }
  };
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  // Defense in depth: clean up on any teardown path (uncaught exception
  // surfaces here too). Reviewer C-5 (applied to serve as well as mcp).
  process.once('beforeExit', () => {
    // Best-effort PID file cleanup; the server + client may have already
    // been closed in shutdown(). beforeExit fires only when the event
    // loop is empty, so we can't await — synchronous unlink.
    try {
      if (existsSync(p.pid)) unlinkSync(p.pid);
    } catch {
      // best-effort
    }
  });

  // Wait forever; the shutdown handler will exit.
  await new Promise<void>(() => undefined);
}
