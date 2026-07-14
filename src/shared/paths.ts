import { join } from 'node:path';

/**
 * Path helpers for a `.substrate/` directory. All paths derive from a single
 * `root`; no caller should build `.substrate/...` paths by hand.
 */
export interface SubstratePaths {
  readonly root: string;
  readonly config: string;
  readonly dataSqlite: string;
  readonly dataSqliteWal: string;
  readonly dataSqliteShm: string;
  readonly pid: string;
  /** Runtime record written by `serve` holding the actually-bound port. */
  readonly serveRuntime: string;
  readonly boardsDir: string;
  readonly attachmentsDir: string;
  readonly logsDir: string;
  readonly logFile: string;
  boardJson: (boardId: string) => string;
  attachmentTaskDir: (taskId: string) => string;
}

export function paths(root: string): SubstratePaths {
  const dataSqlite = join(root, 'data.sqlite');
  return {
    root,
    config: join(root, 'config.json'),
    dataSqlite,
    dataSqliteWal: `${dataSqlite}-wal`,
    dataSqliteShm: `${dataSqlite}-shm`,
    pid: join(root, 'substrate.pid'),
    serveRuntime: join(root, 'serve.json'),
    boardsDir: join(root, 'boards'),
    attachmentsDir: join(root, 'attachments'),
    logsDir: join(root, 'logs'),
    logFile: join(root, 'logs', 'substrate.log'),
    boardJson: (boardId: string) => join(root, 'boards', `${boardId}.json`),
    attachmentTaskDir: (taskId: string) => join(root, 'attachments', taskId),
  };
}

/** Convention: `.substrate/` is at the given cwd. */
export function substrateRootFromCwd(cwd: string): string {
  return join(cwd, '.substrate');
}
