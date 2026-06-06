import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initCommand } from '../../src/cli/commands/init.js';
import { explainCommand } from '../../src/cli/commands/explain.js';
import { SubstrateError } from '../../src/core/errors.js';

describe('explainCommand', () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'substrate-explain-'));
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it('writes a self-contained HTML map at the default path', async () => {
    await initCommand(cwd, { template: 'web-delivery' });
    await explainCommand(cwd);
    const out = join(cwd, 'substrate-explain.html');
    expect(existsSync(out)).toBe(true);
    const html = await readFile(out, 'utf-8');
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<svg');
    expect(html).toContain('Delivery');
    expect(html).not.toContain('<script');
    expect(html).not.toMatch(/src="https?:/);
  });

  it('honors --out (relative to cwd)', async () => {
    await initCommand(cwd, { template: 'web-delivery' });
    await explainCommand(cwd, { out: 'map.html' });
    expect(existsSync(join(cwd, 'map.html'))).toBe(true);
    expect(existsSync(join(cwd, 'substrate-explain.html'))).toBe(false);
  });

  it('works with data.sqlite absent (reads substrate-as-code only)', async () => {
    await initCommand(cwd, { template: 'web-delivery' });
    await rm(join(cwd, '.substrate', 'data.sqlite'), { force: true });
    await explainCommand(cwd, { out: 'no-db.html' });
    expect(existsSync(join(cwd, 'no-db.html'))).toBe(true);
  });

  it('renders "No boards yet" for an empty substrate', async () => {
    await initCommand(cwd); // blank, no board
    await explainCommand(cwd, { out: 'empty.html' });
    const html = await readFile(join(cwd, 'empty.html'), 'utf-8');
    expect(html).toContain('No boards yet');
  });

  it('errors (no file written) when there is no .substrate/', async () => {
    let caught: unknown;
    try {
      await explainCommand(cwd);
    } catch (e) {
      caught = e;
    }
    expect(SubstrateError.is(caught)).toBe(true);
    expect(existsSync(join(cwd, 'substrate-explain.html'))).toBe(false);
  });
});
