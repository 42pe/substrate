import { resolve, sep } from 'node:path';
import { SubstrateError } from '../../core/errors.js';

/**
 * Path-traversal defense. Resolves a path to its absolute canonical form
 * and verifies it sits under `baseDir`. Throws `SubstrateError.forbidden`
 * otherwise.
 *
 * Phase 1 ships this function but does NOT mount any HTTP routes that
 * consume it — no attachment-serving routes exist yet (those land in
 * Phase 4 substrate-edit or Phase 5 UI when attachments are surfaced). The
 * function exists in Phase 1 so the security primitive is in the codebase
 * (and tested) before any vulnerable surface exists.
 *
 * Caveats:
 *  - Does NOT resolve symlinks. If a symlink inside `baseDir` points
 *    outside, this function will accept the request. Defense-in-depth for
 *    that case (use realpath) lives in Phase 4 when attachment routes
 *    actually serve files.
 *  - Comparison is by string prefix on the resolved path + separator;
 *    `/foo` does NOT match `/foobar` (prevents the classic "/foo" vs
 *    "/foobar/..." confusion).
 */
export function assertPathUnder(absPath: string, baseDir: string): void {
  const resolvedPath = resolve(absPath);
  const resolvedBase = resolve(baseDir);

  if (resolvedPath === resolvedBase) {
    return; // The baseDir itself is fine
  }

  const prefix = resolvedBase.endsWith(sep) ? resolvedBase : resolvedBase + sep;
  if (!resolvedPath.startsWith(prefix)) {
    throw SubstrateError.forbidden('Path is outside the permitted base directory', {
      path: absPath,
      base: baseDir,
    });
  }
}
