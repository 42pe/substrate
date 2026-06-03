import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { create as tarCreate, extract as tarExtract, list as tarList } from 'tar';
import { openClient } from '../storage/client.js';
import { paths } from '../shared/paths.js';
import { SubstrateError } from '../core/errors.js';

/**
 * Substrate backup/export/import archives are gzipped tarballs of the durable
 * contents of `.substrate/`: `config.json`, `boards/`, and a consistent
 * `data.sqlite` snapshot. Transient files (`-wal`, `-shm`, `substrate.pid`,
 * `backups/`) are excluded.
 */

const ARCHIVE_ENTRIES = ['config.json', 'boards', 'data.sqlite'] as const;

/** Create a `.tar.gz` of the substrate at `root` into `outPath`. */
export async function createSubstrateArchive(root: string, outPath: string): Promise<void> {
  // Checkpoint the WAL into the main db file so the snapshot is consistent.
  const dbPath = paths(root).dataSqlite;
  if (existsSync(dbPath)) {
    const client = await openClient(dbPath);
    try {
      await client.execute('PRAGMA wal_checkpoint(TRUNCATE)');
    } finally {
      client.close();
    }
  }
  const entries = ARCHIVE_ENTRIES.filter((name) => existsSync(join(root, name)));
  await mkdir(resolve(outPath, '..'), { recursive: true });
  await tarCreate({ gzip: true, file: outPath, cwd: root }, entries);
}

/**
 * Validate that an archive's entries all stay within `.substrate/`-relative
 * shape (zip-slip / path-traversal guard, R3). Rejects absolute paths, `..`
 * segments, and anything outside the allowed top-level entries. Throws
 * `schema_violation` on a violation; throws `internal_error` on an unreadable
 * archive. Mandatory regardless of tar library defaults.
 */
export async function assertArchiveSafe(archivePath: string): Promise<void> {
  const allowedRoots = new Set<string>(ARCHIVE_ENTRIES);
  const offenders: string[] = [];
  try {
    await tarList({
      file: archivePath,
      onentry: (entry) => {
        const p = entry.path;
        const top = p.split(/[/\\]/)[0] ?? '';
        if (
          p.startsWith('/') ||
          p.startsWith('\\') ||
          /^[A-Za-z]:/.test(p) || // windows drive
          p.split(/[/\\]/).includes('..') ||
          !allowedRoots.has(top)
        ) {
          offenders.push(p);
        }
      },
    });
  } catch (e) {
    throw SubstrateError.internalError(`Could not read archive: ${(e as Error).message}`, {
      archive: archivePath,
    });
  }
  if (offenders.length > 0) {
    throw SubstrateError.schemaViolation(
      `Archive contains unsafe paths and was rejected: ${offenders.slice(0, 5).join(', ')}`,
      { offenders: offenders.slice(0, 20) },
    );
  }
}

/** Extract a validated archive into `targetRoot` (the `.substrate/` dir). */
export async function extractSubstrateArchive(
  archivePath: string,
  targetRoot: string,
): Promise<void> {
  await assertArchiveSafe(archivePath);
  await mkdir(targetRoot, { recursive: true });
  const targetResolved = resolve(targetRoot);
  await tarExtract({
    file: archivePath,
    cwd: targetRoot,
    preservePaths: false, // tar strips leading '/' and '..'; we also pre-validated
    filter: (path: string) => {
      // Defense in depth: never let an entry escape targetRoot.
      const dest = resolve(targetRoot, path);
      return dest === targetResolved || dest.startsWith(targetResolved + sep);
    },
  });
}
