import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { rmrfSync } from '../../../tests/helpers/tmp.js';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logsCommand } from './logs.js';
import { paths, substrateRootFromCwd } from '../../shared/paths.js';
import { parseEvents } from '../../shared/log-read.js';
import { SubstrateError } from '../../core/errors.js';

const SAMPLE = [
  '2026-06-09T10:00:00.000Z INFO Substrate running on http://localhost:7475',
  '2026-06-09T10:00:01.000Z WARN something odd {"agent_name":"[a]"}',
  '2026-06-09T10:00:02.000Z ERROR Unhandled error in create_task {"error":"boom"}',
  '    Error: boom',
  '        at foo (/x.js:1:1)',
  '2026-06-09T10:00:03.000Z ERROR Unhandled error in update_task {"error":"bad"}',
  '    Error: bad',
  '        at bar (/y.js:2:2)',
  '',
].join('\n');

describe('logsCommand', () => {
  let cwd: string;
  let out: string[];

  function output(): string {
    return out.join('');
  }
  function seed(content: string, name = 'substrate.log'): void {
    const root = substrateRootFromCwd(cwd);
    mkdirSync(paths(root).logsDir, { recursive: true });
    writeFileSync(join(paths(root).logsDir, name), content);
  }
  function initSubstrate(): void {
    mkdirSync(substrateRootFromCwd(cwd), { recursive: true });
  }

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'substrate-logscmd-'));
    out = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => {
      out.push(String(s));
      return true;
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmrfSync(cwd);
  });

  it('throws not_found when there is no .substrate/', () => {
    try {
      logsCommand(cwd, {});
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(SubstrateError.is(e) && e.code).toBe('not_found');
    }
  });

  it('prints a distinct "No log file yet" message when .substrate/ has no log', () => {
    initSubstrate();
    logsCommand(cwd, {});
    expect(output()).toContain('No log file yet');
    expect(output()).not.toContain('no errors in the log');
  });

  it('prints the last N lines by default', () => {
    seed(SAMPLE);
    logsCommand(cwd, { n: '1' });
    expect(output()).toContain('at bar (/y.js:2:2)'); // last content line
    expect(output()).not.toContain('Substrate running'); // not the first
  });

  it('rejects a non-positive-integer -n', () => {
    seed(SAMPLE);
    expect(() => logsCommand(cwd, { n: 'abc' })).toThrow(/positive integer/);
    expect(() => logsCommand(cwd, { n: '0' })).toThrow(/positive integer/);
  });

  it('--errors filters to ERROR events with their stack blocks', () => {
    seed(SAMPLE);
    logsCommand(cwd, { errors: true });
    const o = output();
    expect(o).toContain('Unhandled error in create_task');
    expect(o).toContain('at foo (/x.js:1:1)'); // create_task's block
    expect(o).toContain('Unhandled error in update_task');
    expect(o).toContain('at bar (/y.js:2:2)'); // update_task's block
    expect(o).not.toContain('something odd'); // the WARN is excluded
  });

  it('--errors honors -n (last N error events only)', () => {
    seed(SAMPLE);
    logsCommand(cwd, { errors: true, n: '1' });
    const o = output();
    expect(o).toContain('Unhandled error in update_task'); // the last error
    expect(o).not.toContain('Unhandled error in create_task');
  });

  it('--errors prints "no errors in the log" when only WARN/INFO exist', () => {
    seed(
      ['2026-06-09T10:00:00.000Z INFO up', '2026-06-09T10:00:01.000Z WARN odd {"x":1}', ''].join(
        '\n',
      ),
    );
    logsCommand(cwd, { errors: true });
    expect(output()).toContain('no errors in the log');
    expect(output()).not.toContain('No log file yet'); // distinct empty-state
  });

  it('reads across rotation (.1 then current) to satisfy -n', () => {
    seed('2026-06-09T09:00:00.000Z ERROR old failure {"error":"old"}\n', 'substrate.log.1');
    seed('2026-06-09T10:00:00.000Z ERROR new failure {"error":"new"}\n', 'substrate.log');
    logsCommand(cwd, { errors: true, n: '10' });
    const o = output();
    expect(o.indexOf('old failure')).toBeGreaterThanOrEqual(0);
    expect(o.indexOf('new failure')).toBeGreaterThan(o.indexOf('old failure')); // oldest first
  });
});

describe('parseEvents (stack-block boundary)', () => {
  it('anchors a stack block on the next header, not on indentation', () => {
    const lines = [
      '2026-06-09T10:00:00.000Z ERROR first {"e":1}',
      'unindented continuation still belongs to first', // not a header → first's body
      '2026-06-09T10:00:01.000Z INFO a header ends the block',
      '2026-06-09T10:00:02.000Z ERROR second {"e":2}',
      '    Error: two',
    ];
    const events = parseEvents(lines);
    expect(events.map((e) => e.level)).toEqual(['ERROR', 'INFO', 'ERROR']);
    expect(events[0]!.body).toEqual(['unindented continuation still belongs to first']);
    expect(events[1]!.body).toEqual([]); // INFO header's block is empty
    expect(events[2]!.body).toEqual(['    Error: two']);
  });
});
