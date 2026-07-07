import { describe, it, expect, vi, afterEach } from 'vitest';
import { rmrfSync } from '../../tests/helpers/tmp.js';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { wrapToolHandler } from './wrapper.js';
import { SubstrateError } from '../core/errors.js';
import { errorEnvelope, successEnvelope } from '../core/envelope.js';
import { configureFileSink, resetFileSink } from '../shared/logger.js';

const schema = z.object({ id: z.string().min(1), agent_name: z.string().min(1) });

function parse(result: { content: { type: 'text'; text: string }[] }): unknown {
  return JSON.parse(result.content[0]!.text);
}

describe('wrapToolHandler', () => {
  it('passes validated input to the handler and returns its raw result', async () => {
    const wrapped = wrapToolHandler('t', schema, (input) => Promise.resolve({ echoed: input.id }));
    const result = await wrapped({ id: 'x', agent_name: 'a' });
    expect(result.isError).toBe(false);
    expect(parse(result)).toEqual({ echoed: 'x' });
  });

  it('returns a schema_violation envelope on invalid input (no throw)', async () => {
    const handler = vi.fn();
    const wrapped = wrapToolHandler('t', schema, handler);
    const result = await wrapped({ id: '' }); // missing agent_name, empty id
    expect(result.isError).toBe(true);
    const env = parse(result) as { ok: boolean; error: { code: string; details?: unknown } };
    expect(env.ok).toBe(false);
    expect(env.error.code).toBe('schema_violation');
    expect(env.error.details).toHaveProperty('issues');
    expect(handler).not.toHaveBeenCalled();
  });

  it('converts a thrown SubstrateError into its error envelope', async () => {
    const wrapped = wrapToolHandler('t', schema, () => {
      throw SubstrateError.notFound('Task gone', { entity: 'task', id: 'z' });
    });
    const result = await wrapped({ id: 'z', agent_name: 'a' });
    expect(result.isError).toBe(true);
    const env = parse(result) as { error: { code: string; details?: unknown } };
    expect(env.error.code).toBe('not_found');
    expect(env.error.details).toEqual({ entity: 'task', id: 'z' });
  });

  it('returns a generic internal_error and does NOT leak an unknown error message', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const wrapped = wrapToolHandler('t', schema, () => {
      throw new Error('secret: db at hunter2@internal');
    });
    const result = await wrapped({ id: 'z', agent_name: 'a' });
    expect(result.isError).toBe(true);
    const env = parse(result) as { error: { code: string; message: string } };
    expect(env.error.code).toBe('internal_error');
    expect(env.error.message).toBe('Internal error');
    expect(JSON.stringify(env)).not.toContain('hunter2');
    spy.mockRestore();
  });

  it('writes the stack to the file sink while the envelope stays generic (asymmetry)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'substrate-wrap-'));
    const logFile = join(dir, 'logs', 'substrate.log');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    configureFileSink(logFile);
    try {
      const wrapped = wrapToolHandler('t', schema, () => {
        throw new Error('secret: db at hunter2@internal');
      });
      const result = await wrapped({ id: 'z', agent_name: 'a' });
      const env = parse(result) as { error: { code: string; message: string } };
      // Boundary (unchanged): generic, no raw message, no stack.
      expect(env.error.code).toBe('internal_error');
      expect(env.error.message).toBe('Internal error');
      expect(JSON.stringify(env)).not.toContain('hunter2');
      // Local file (new): full detail incl. the stack.
      const log = readFileSync(logFile, 'utf-8');
      expect(log).toContain('ERROR Unhandled error in t');
      expect(log).toContain('hunter2'); // the file may carry the raw message
      expect(log).toMatch(/\n {4,}at /); // stack block present
    } finally {
      spy.mockRestore();
      rmrfSync(dir);
    }
  });

  // MANDATED isolation (CONCERN-1): no test leaves the sink configured.
  afterEach(() => {
    resetFileSink();
  });

  it('marks isError when a handler returns an ok:false envelope', async () => {
    const wrapped = wrapToolHandler('t', schema, () =>
      Promise.resolve(errorEnvelope(SubstrateError.conflict('nope', { id: 'z' }))),
    );
    const result = await wrapped({ id: 'z', agent_name: 'a' });
    expect(result.isError).toBe(true);
  });

  it('does not mark isError when a handler returns an ok:true envelope', async () => {
    const wrapped = wrapToolHandler('t', schema, () =>
      Promise.resolve(successEnvelope({ entity: 'task', id: 'z', version: 1, state: { id: 'z' } })),
    );
    const result = await wrapped({ id: 'z', agent_name: 'a' });
    expect(result.isError).toBe(false);
  });

  it('B4: logs a handled tool error at ERROR so `substrate logs --errors` shows it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'substrate-wrap-'));
    const logFile = join(dir, 'logs', 'substrate.log');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    configureFileSink(logFile);
    try {
      const wrapped = wrapToolHandler('get_task', schema, () => {
        throw SubstrateError.notFound('Task gone', { entity: 'task', id: 'z' });
      });
      await wrapped({ id: 'z', agent_name: 'a' });
      const log = readFileSync(logFile, 'utf-8');
      // ERROR level → picked up by `substrate logs --errors` (which filters to ERROR).
      expect(log).toContain('ERROR get_task returned not_found');
    } finally {
      spy.mockRestore();
      rmrfSync(dir);
    }
  });

  it('B4: excludes expected control-flow codes (version_mismatch) from the log trail', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'substrate-wrap-'));
    const logFile = join(dir, 'logs', 'substrate.log');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    configureFileSink(logFile);
    try {
      // A control-flow error (expected outcome) → not logged.
      const wm = wrapToolHandler('update_task', schema, () =>
        Promise.resolve(
          errorEnvelope(SubstrateError.versionMismatch('stale', { id: 'z', current_version: 2 })),
        ),
      );
      await wm({ id: 'z', agent_name: 'a' });
      // A genuine handled error → logged (and creates the file).
      const nf = wrapToolHandler('get_task', schema, () => {
        throw SubstrateError.notFound('gone', { entity: 'task', id: 'z' });
      });
      await nf({ id: 'z', agent_name: 'a' });
      const log = readFileSync(logFile, 'utf-8');
      expect(log).toContain('not_found'); // the real error is in the trail
      expect(log).not.toContain('version_mismatch'); // control-flow excluded
    } finally {
      spy.mockRestore();
      rmrfSync(dir);
    }
  });

  it('B4: a newline-laden value in the error message cannot forge a log line', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'substrate-wrap-'));
    const logFile = join(dir, 'logs', 'substrate.log');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    configureFileSink(logFile);
    try {
      const evil = 'x\n2026-07-07T00:00:00.000Z ERROR forged-line';
      const wrapped = wrapToolHandler('get_task', schema, () => {
        throw SubstrateError.notFound(`Task ${evil} not found`, { entity: 'task', id: evil });
      });
      await wrapped({ id: 'z', agent_name: 'a' });
      const log = readFileSync(logFile, 'utf-8');
      // The message rides in the JSON-serialized context (escaped), so the whole
      // event is one line — no second, forged header.
      const headers = log
        .split('\n')
        .filter((l) => /^\d{4}-\d\d-\d\dT.*\b(INFO|WARN|ERROR)\b /.test(l));
      expect(headers).toHaveLength(1);
      expect(log).not.toContain('\nforged-line');
    } finally {
      spy.mockRestore();
      rmrfSync(dir);
    }
  });
});
