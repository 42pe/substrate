import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { substrateRootFromCwd, paths } from '../../shared/paths.js';
import { readConfig } from '../../shared/config.js';
import { loadSubstrate } from '../../substrate/loader.js';
import { openClient } from '../../storage/client.js';
import { getCurrentSchemaVersion } from '../../storage/migrations/runner.js';
import { isPortInUse, isProcessAlive, portCandidates } from '../../shared/process.js';
import { readServeRuntime } from '../../shared/serve-runtime.js';
import { compareSkill } from '../../core/skill.js';
import { DEFAULT_PORT, PORT_RANGE_START, PORT_RANGE_END } from '../../http/server.js';
import { BINARY_VERSION, BINARY_SCHEMA_VERSION } from '../../core/version.js';
import { readCurrentLines, parseEvents } from '../../shared/log-read.js';

/**
 * `substrate diagnose` — print environment + substrate health. Built to run
 * even when the substrate is broken: EVERY probe is wrapped, so a missing or
 * garbage `config.json` yields a diagnostic line, never a crash. Exits non-zero
 * if any problem is found.
 */
export async function diagnoseCommand(cwd: string): Promise<void> {
  const root = substrateRootFromCwd(cwd);
  const p = paths(root);
  let problems = 0;
  const ok = (label: string, detail = ''): void => {
    process.stdout.write(`  ✓ ${label} ${detail}\n`);
  };
  const bad = (label: string, detail = ''): void => {
    problems += 1;
    process.stdout.write(`  ✗ ${label} ${detail}\n`);
  };

  process.stdout.write(`Substrate diagnose — ${root}\n\n`);

  // Environment
  process.stdout.write('Environment:\n');
  ok('substrate version', BINARY_VERSION);
  ok('node', process.version);
  ok('platform', `${process.platform}/${process.arch}`);

  // Server: prefer the per-project runtime record (the actually-bound port when
  // the free-port fallback moved off 7475); fall back to probing the range so
  // the operator can answer "which port is this project on?" without lsof.
  process.stdout.write('\nServer:\n');
  try {
    const runtime = await readServeRuntime(p.serveRuntime);
    if (runtime && isProcessAlive(runtime.pid)) {
      ok('server', `serving on port ${runtime.port} (pid ${runtime.pid})`);
    } else {
      if (runtime) {
        ok('server', `stale runtime record (pid ${runtime.pid} not running) — ignoring`);
      }
      const inUse: number[] = [];
      for (const candidate of portCandidates(DEFAULT_PORT, PORT_RANGE_START, PORT_RANGE_END)) {
        if (await isPortInUse(candidate)) inUse.push(candidate);
      }
      if (inUse.length === 0) {
        ok('server', `no server running here (ports ${PORT_RANGE_START}–${PORT_RANGE_END} free)`);
      } else {
        ok('server', `no live record here; ports in use in range: ${inUse.join(', ')}`);
      }
    }
  } catch {
    bad('server', 'could not probe');
  }

  // Substrate integrity
  process.stdout.write('\nSubstrate:\n');
  if (!existsSync(root)) {
    bad('.substrate/', 'missing — run `substrate init`');
  } else {
    ok('.substrate/', 'present');
    try {
      const config = await readConfig(root);
      ok('config.json', `project '${config.project_name}' (v${config.version})`);
    } catch (e) {
      bad('config.json', (e as Error).message);
    }
    try {
      const substrate = await loadSubstrate(root);
      const groups = substrate.boards.reduce((n, b) => n + b.groups.length, 0);
      const policies = substrate.boards.reduce((n, b) => n + b.policies.length, 0);
      ok(
        'boards/',
        `${substrate.boards.length} board(s), ${groups} group(s), ${policies} policy(s)`,
      );
      // Member registry + advisory integrity warnings. A member/team warning is
      // NOT a health problem (the layer is optional) — it never affects the exit
      // code; it's surfaced so `diagnose` hints at running `substrate validate`.
      if (substrate.warnings.length === 0) {
        ok('members/', `${substrate.members.length} member(s), no integrity warnings`);
      } else {
        ok(
          'members/',
          `${substrate.members.length} member(s), ${substrate.warnings.length} advisory warning(s) — run 'substrate validate' for details`,
        );
      }
    } catch (e) {
      bad('boards/', (e as Error).message);
    }
    try {
      if (existsSync(p.dataSqlite)) {
        const client = await openClient(p.dataSqlite);
        try {
          const v = await getCurrentSchemaVersion(client);
          const tag =
            v === BINARY_SCHEMA_VERSION ? 'current' : `binary expects ${BINARY_SCHEMA_VERSION}`;
          ok('data.sqlite', `schema v${v} (${tag})`);
        } finally {
          client.close();
        }
      } else {
        bad('data.sqlite', 'missing');
      }
    } catch (e) {
      bad('data.sqlite', (e as Error).message);
    }
    try {
      const backupsDir = join(p.root, 'backups');
      const count = existsSync(backupsDir)
        ? (await readdir(backupsDir)).filter((f) => f.endsWith('.tar.gz')).length
        : 0;
      ok('backups/', `${count} backup(s)`);
    } catch {
      ok('backups/', '0 backup(s)');
    }

    // Recent errors (Phase 7b): the last 5 ERROR header lines, stacks excluded
    // (the full stacks would bloat a diagnose dump). Historical — never counted
    // as a current-health problem, so the exit code is unaffected.
    try {
      const errs = parseEvents(readCurrentLines(p.logFile)).filter((e) => e.level === 'ERROR');
      if (errs.length === 0) {
        ok('logs/', 'no recent errors');
      } else {
        const recent = errs.slice(-5);
        ok('logs/', `${errs.length} error(s) logged — showing last ${recent.length}`);
        process.stdout.write('  Recent errors:\n');
        for (const e of recent) {
          const h = e.header.length > 200 ? `${e.header.slice(0, 200)}…` : e.header;
          process.stdout.write(`    ${h}\n`);
        }
        process.stdout.write(
          `    Full log: ${p.logFile} — run 'substrate logs --errors' for more.\n`,
        );
      }
    } catch {
      ok('logs/', 'no recent errors');
    }
  }

  // Installed agent skill vs binary. A concrete version/content *drift* on a
  // stamped skill is a hard problem (it means agents are reading stale facts).
  // "not installed" / "unstamped" is advisory (common where the skill isn't
  // used, or predates stamping) — repair both with `substrate install-skill`.
  process.stdout.write('\nSkill:\n');
  try {
    const cmp = compareSkill();
    if (cmp.state === 'ok') {
      ok('installed skill', `in sync (v${cmp.expected})`);
    } else if (cmp.state === 'missing') {
      ok('installed skill', `not installed — run 'substrate install-skill'`);
    } else if (cmp.installed === null) {
      ok('installed skill', `installed but unstamped — run 'substrate install-skill'`);
    } else {
      bad('installed skill', `drift — ${cmp.reason}; run 'substrate install-skill'`);
    }
  } catch (e) {
    ok('installed skill', `could not check (${(e as Error).message})`);
  }

  process.stdout.write(
    `\n${problems === 0 ? 'No problems found.' : `${problems} problem(s) found.`}\n`,
  );
  if (problems > 0) process.exitCode = 1;
}
