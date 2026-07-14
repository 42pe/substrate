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
  PORT_RANGE_START,
  PORT_RANGE_END,
  type HttpConfig,
} from '../../http/server.js';
import { SubstrateError } from '../../core/errors.js';
import { logger, configureFileSink } from '../../shared/logger.js';
import {
  isProcessAlive,
  identifyPortHolder,
  portCandidates,
  bindFirstFreePort,
  NoFreePortError,
} from '../../shared/process.js';
import {
  writeServeRuntime,
  clearServeRuntime,
  clearServeRuntimeSync,
} from '../../shared/serve-runtime.js';
import { warnIfFreshDbWithBoards } from '../../shared/startup-checks.js';

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
 *   4. Bind Hono to 127.0.0.1. The preferred port is 7475; if it's taken, serve
 *      scans upward through 7475–7499 for the first free port so multiple
 *      projects' inspectors can coexist. EADDRINUSE on a candidate is caught via
 *      the underlying server's async `'error'` event (Reviewer B-1 fix) and
 *      advances to the next candidate; range exhaustion fails with a clear
 *      error. The actually-bound port is recorded in `.substrate/serve.json` so
 *      `diagnose` and the operator can find it.
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
  // Persist warn/error to .substrate/logs/substrate.log for this long-lived
  // process (Phase 7b). info stays console-only.
  configureFileSink(p.logFile);
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
  const dbExisted = existsSync(p.dataSqlite);
  const client = await openDatabaseAndMigrate(p.dataSqlite);
  warnIfFreshDbWithBoards(root, dbExisted); // B7: worktree/fresh-clone empty-DB footgun

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

  // Build + bind the app for one candidate port. The CORS/Host allowlist embeds
  // the port, so the config + app must be rebuilt per attempt in the scan.
  const buildAndBind = (candidatePort: number): ReturnType<typeof startHttpServer> => {
    const httpConfig: HttpConfig = {
      ...defaultHttpConfig(),
      port: candidatePort,
      allowedOrigins: [`http://localhost:${candidatePort}`, `http://127.0.0.1:${candidatePort}`],
      allowedHosts: [`localhost:${candidatePort}`, `127.0.0.1:${candidatePort}`],
      // Read API deps (Phase 5a): reuses the client serve already opened. No
      // `root` — the HTTP surface is reads-only.
      apiDeps: { client, config, loadSubstrate: () => loadSubstrate(root) },
    };
    return startHttpServer(createApp(httpConfig), candidatePort);
  };

  // SUBSTRATE_PORT_OVERRIDE pins an exact port (tests) — bind it only, no scan.
  // Otherwise try the preferred port first, then scan the fallback range so a
  // second project can serve while the first holds 7475. Selection is driven by
  // the real bind (not pre-probing) so racing serves can't pick the same port.
  const candidates =
    portRaw !== undefined ? [port] : portCandidates(DEFAULT_PORT, PORT_RANGE_START, PORT_RANGE_END);

  let server: Awaited<ReturnType<typeof startHttpServer>>;
  let boundPort: number;
  try {
    const bound = await bindFirstFreePort(candidates, buildAndBind);
    server = bound.value;
    boundPort = bound.port;
  } catch (e) {
    client.close();
    if (e instanceof NoFreePortError) {
      if (portRaw !== undefined) {
        // Exact-port mode: keep the original single-port conflict message.
        const holder = await identifyPortHolder(port);
        throw SubstrateError.conflict(
          `Port ${port} is already in use${holder ? ` by ${holder}` : ''}. ` +
            `Stop that process or change the port.`,
          { port, ...(holder ? { holder } : {}) },
        );
      }
      throw SubstrateError.conflict(
        `No free port in range ${PORT_RANGE_START}–${PORT_RANGE_END} ` +
          `(all ${PORT_RANGE_END - PORT_RANGE_START + 1} in use). ` +
          `Stop a running 'substrate serve' instance or free a port in that range.`,
        { range_start: PORT_RANGE_START, range_end: PORT_RANGE_END },
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

  // Additive discovery record: the actually-bound port. Written AFTER the PID
  // lock so it never exists without an owner, and cleared on every teardown
  // path below. NOT the ownership guard — substrate.pid remains that.
  await writeServeRuntime(p.serveRuntime, {
    pid: process.pid,
    port: boundPort,
    started_at: new Date().toISOString(),
  });

  logger.info(`Substrate running on http://localhost:${boundPort}`, {
    pid: process.pid,
    port: boundPort,
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
      await clearServeRuntime(p.serveRuntime);
      process.exit(0);
    } catch (err) {
      logger.error('Error during shutdown', { error: (err as Error).message, err });
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
    clearServeRuntimeSync(p.serveRuntime);
  });

  // Wait forever; the shutdown handler will exit.
  await new Promise<void>(() => undefined);
}
