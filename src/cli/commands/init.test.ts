import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { initCommand } from './init.js';
import { loadSubstrate } from '../../substrate/loader.js';
import { readConfig } from '../../shared/config.js';
import { openClient } from '../../storage/client.js';
import { getCurrentSchemaVersion } from '../../storage/migrations/runner.js';
import { BINARY_SCHEMA_VERSION } from '../../core/version.js';
import { SubstrateError } from '../../core/errors.js';

describe('initCommand', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'substrate-init-'));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it('creates the full .substrate/ directory tree', async () => {
    const { root } = await initCommand(cwd);
    expect(existsSync(root)).toBe(true);
    expect(existsSync(join(root, 'boards'))).toBe(true);
    expect(existsSync(join(root, 'attachments'))).toBe(true);
    expect(existsSync(join(root, 'config.json'))).toBe(true);
    expect(existsSync(join(root, 'data.sqlite'))).toBe(true);
  });

  it('writes a valid config.json with project_id (uuid), project_name (basename), schema_version', async () => {
    const { config } = await initCommand(cwd);
    expect(config.project_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(config.project_name).toBe(basename(cwd));
    expect(config.schema_version).toBe(BINARY_SCHEMA_VERSION);

    // Round-trip
    const read = await readConfig(join(cwd, '.substrate'));
    expect(read).toEqual(config);
  });

  it('initializes data.sqlite with schema 001 applied (user_version = 1)', async () => {
    await initCommand(cwd);
    const client = await openClient(join(cwd, '.substrate', 'data.sqlite'));
    try {
      const v = await getCurrentSchemaVersion(client);
      expect(v).toBe(BINARY_SCHEMA_VERSION);
      const tables = await client.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'",
      );
      expect(tables.rows).toHaveLength(1);
    } finally {
      client.close();
    }
  });

  it('creates a .gitignore if absent', async () => {
    await initCommand(cwd);
    const gi = await readFile(join(cwd, '.gitignore'), 'utf-8');
    expect(gi).toContain('# substrate:v1:gitignore-block (managed by `substrate init`)');
    expect(gi).toContain('.substrate/data.sqlite');
    expect(gi).toContain('.substrate/attachments/');
    expect(gi).toContain('.substrate/logs/'); // covers substrate.log AND .log.1
  });

  it('appends to an existing .gitignore that has no Substrate block', async () => {
    await writeFile(join(cwd, '.gitignore'), 'node_modules/\n*.log\n', 'utf-8');
    await initCommand(cwd);
    const gi = await readFile(join(cwd, '.gitignore'), 'utf-8');
    expect(gi).toContain('node_modules/');
    expect(gi).toContain('*.log');
    expect(gi).toContain('# substrate:v1:gitignore-block (managed by `substrate init`)');
  });

  it('is idempotent on .gitignore — does not add a second block', async () => {
    await initCommand(cwd);
    // Simulate user re-running init by removing only .substrate/ (keep .gitignore)
    await rm(join(cwd, '.substrate'), { recursive: true });
    await initCommand(cwd);
    const gi = await readFile(join(cwd, '.gitignore'), 'utf-8');
    const occurrences =
      gi.split('# substrate:v1:gitignore-block (managed by `substrate init`)').length - 1;
    expect(occurrences).toBe(1);
  });

  it('refuses to re-init when .substrate/ already exists', async () => {
    await initCommand(cwd);
    let caught: unknown;
    try {
      await initCommand(cwd);
    } catch (e) {
      caught = e;
    }
    expect(SubstrateError.is(caught)).toBe(true);
    if (SubstrateError.is(caught)) {
      expect(caught.code).toBe('conflict');
      expect(caught.message).toMatch(/already exists/i);
    }
  });

  describe('--template (opt-in starter board)', () => {
    it('bare init creates NO board (blank)', async () => {
      const { root } = await initCommand(cwd);
      expect(existsSync(join(root, 'boards', 'delivery.json'))).toBe(false);
    });

    it('--template web-delivery writes a loadable delivery board', async () => {
      const { root } = await initCommand(cwd, { template: 'web-delivery' });
      expect(existsSync(join(root, 'boards', 'delivery.json'))).toBe(true);
      const substrate = await loadSubstrate(root);
      expect(substrate.boards.map((b) => b.id)).toContain('delivery');
    });

    it('unknown template errors AND does not create .substrate/', async () => {
      let caught: unknown;
      try {
        await initCommand(cwd, { template: 'bogus' });
      } catch (e) {
        caught = e;
      }
      expect(SubstrateError.is(caught)).toBe(true);
      if (SubstrateError.is(caught)) {
        expect(caught.code).toBe('schema_violation');
        expect(caught.message).toMatch(/unknown template/i);
        expect(caught.message).toMatch(/web-delivery/);
      }
      expect(existsSync(join(cwd, '.substrate'))).toBe(false);
    });

    it('template-name error WINS over the existing-.substrate/ conflict', async () => {
      await initCommand(cwd); // .substrate/ now exists
      let caught: unknown;
      try {
        await initCommand(cwd, { template: 'bogus' });
      } catch (e) {
        caught = e;
      }
      expect(SubstrateError.is(caught)).toBe(true);
      if (SubstrateError.is(caught)) expect(caught.code).toBe('schema_violation'); // not 'conflict'
    });

    it('valid template when .substrate/ already exists → conflict', async () => {
      await initCommand(cwd);
      let caught: unknown;
      try {
        await initCommand(cwd, { template: 'web-delivery' });
      } catch (e) {
        caught = e;
      }
      expect(SubstrateError.is(caught) && caught.code).toBe('conflict');
    });
  });
});
