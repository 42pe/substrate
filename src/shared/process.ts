import { createServer } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Platform-branched process / port helpers (Phase 4). Kept side-effect-free and
 * narrow so the serve lifecycle is testable. None of these ever throw —
 * `identifyPortHolder` returns null when it can't tell.
 */

/**
 * True if a process with the given PID is alive. `process.kill(pid, 0)` sends
 * no signal but throws ESRCH if the target is gone (EPERM ⇒ exists but we can't
 * signal — treat as alive, conservative).
 *
 * Windows gap (documented): `process.kill(pid, 0)` is less precise there; that
 * surfaces when Phase 6 CI runs on Windows.
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EPERM') return true;
    return false;
  }
}

/**
 * Ordered list of candidate ports for the serve free-port fallback: the
 * `preferred` port first, then every port in `start..end` (inclusive) except
 * `preferred` (so it's never tried twice). Pure + deterministic — the actual
 * "is it free?" decision is made by `bindFirstFreePort` attempting a real bind,
 * not by pre-probing (avoids a TOCTOU gap).
 */
export function portCandidates(preferred: number, start: number, end: number): number[] {
  const out = [preferred];
  for (let port = start; port <= end; port += 1) {
    if (port !== preferred) out.push(port);
  }
  return out;
}

/** Thrown by `bindFirstFreePort` when every candidate port was in use. */
export class NoFreePortError extends Error {
  readonly code = 'ENOFREEPORT';
  constructor(readonly candidates: readonly number[]) {
    super(`No free port among candidates [${candidates.join(', ')}]`);
    this.name = 'NoFreePortError';
  }
}

/**
 * Walk `candidates` in order, calling `bind(port)` for each; return the first
 * that succeeds along with its resolved value. A candidate that fails with
 * `EADDRINUSE` advances to the next; any other error rejects immediately. If
 * every candidate is in use, rejects with {@link NoFreePortError}.
 *
 * Selection is driven by the REAL bind (not `isPortInUse` pre-probing) so there
 * is no check-then-bind race: whichever process wins the actual bind owns the
 * port, and the loser simply advances.
 */
export async function bindFirstFreePort<T>(
  candidates: readonly number[],
  bind: (port: number) => Promise<T>,
): Promise<{ port: number; value: T }> {
  for (const port of candidates) {
    try {
      const value = await bind(port);
      return { port, value };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EADDRINUSE') continue;
      throw e;
    }
  }
  throw new NoFreePortError(candidates);
}

/** True if `port` on 127.0.0.1 is already bound. Resolves false on any oddity. */
export function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = createServer();
    tester.once('error', (e: NodeJS.ErrnoException) => {
      tester.close();
      resolve(e.code === 'EADDRINUSE');
    });
    tester.once('listening', () => {
      tester.close(() => resolve(false));
    });
    tester.listen(port, '127.0.0.1');
  });
}

/**
 * Best-effort identification of the process holding `port`. Returns a short
 * human string (e.g. "node (pid 1234)") or null when it can't tell. Never
 * throws — used only to enrich an error message.
 */
export async function identifyPortHolder(port: number): Promise<string | null> {
  try {
    if (process.platform === 'win32') {
      // netstat -ano → find the PID owning the LISTENING socket on :port.
      const { stdout } = await execFileAsync('netstat', ['-ano']);
      for (const line of stdout.split(/\r?\n/)) {
        if (line.includes(`:${port} `) && /LISTENING/i.test(line)) {
          const pid = line.trim().split(/\s+/).pop();
          if (pid) return `pid ${pid}`;
        }
      }
      return null;
    }
    // POSIX: lsof -nP -iTCP:<port> -sTCP:LISTEN
    const { stdout } = await execFileAsync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN']);
    const lines = stdout.trim().split(/\r?\n/);
    const dataLine = lines.find((l) => !l.startsWith('COMMAND'));
    if (!dataLine) return null;
    const cols = dataLine.trim().split(/\s+/);
    const command = cols[0];
    const pid = cols[1];
    if (command && pid) return `${command} (pid ${pid})`;
    return null;
  } catch {
    return null; // lsof/netstat missing or no match — can't identify
  }
}
