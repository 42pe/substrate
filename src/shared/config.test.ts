import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readConfig, writeConfig } from './config.js';
import { SubstrateError } from '../core/errors.js';
import type { Config } from '../core/types.js';

// Each test owns its tempdir and cleans it up via afterEach.
let tempDirs: string[] = [];

async function makeTempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'substrate-test-'));
  tempDirs.push(dir);
  const root = join(dir, '.substrate');
  await mkdir(root, { recursive: true });
  return root;
}

afterEach(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(
      () => undefined,
    );
  }
  tempDirs = [];
});

const validConfig: Config = {
  project_id: '12345678-1234-4123-8123-123456789012',
  project_name: 'TestProject',
  description: '',
  version: 1,
  schema_version: 1,
  created_at: '2026-05-09T00:00:00.000Z',
};

describe('writeConfig / readConfig (round-trip)', () => {
  let root: string;
  beforeEach(async () => {
    root = await makeTempRoot();
  });

  it('writes and reads back a valid config', async () => {
    await writeConfig(root, validConfig);
    const read = await readConfig(root);
    expect(read).toEqual(validConfig);
  });

  it('writes JSON formatted with 2-space indent + trailing newline', async () => {
    await writeConfig(root, validConfig);
    const { readFile } = await import('node:fs/promises');
    const raw = await readFile(join(root, 'config.json'), 'utf-8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(raw).toContain('  "project_id"');
  });
});

describe('Config backward-compat (Phase 4 version/description)', () => {
  let root: string;
  beforeEach(async () => {
    root = await makeTempRoot();
  });

  it('reads a legacy config (no version/description) with defaults', async () => {
    // A Phase 1–3 config.json lacks version + description.
    const legacy = {
      project_id: '12345678-1234-4123-8123-123456789012',
      project_name: 'Legacy',
      schema_version: 2,
      created_at: '2026-05-09T00:00:00.000Z',
    };
    await writeFile(join(root, 'config.json'), `${JSON.stringify(legacy, null, 2)}\n`, 'utf-8');
    const read = await readConfig(root);
    expect(read.version).toBe(1);
    expect(read.description).toBe('');
  });

  it('round-trips: a read-defaulted legacy config materializes the fields on write', async () => {
    const legacy = {
      project_id: '12345678-1234-4123-8123-123456789012',
      project_name: 'Legacy',
      schema_version: 2,
      created_at: '2026-05-09T00:00:00.000Z',
    };
    await writeFile(join(root, 'config.json'), `${JSON.stringify(legacy, null, 2)}\n`, 'utf-8');
    const read = await readConfig(root);
    await writeConfig(root, read);
    const raw = await readFile(join(root, 'config.json'), 'utf-8');
    expect(raw).toContain('"version"');
    expect(raw).toContain('"description"');
  });
});

describe('readConfig errors', () => {
  let root: string;
  beforeEach(async () => {
    root = await makeTempRoot();
  });

  it('throws notFound when config.json missing', async () => {
    try {
      await readConfig(root);
      throw new Error('expected throw');
    } catch (e) {
      expect(SubstrateError.is(e)).toBe(true);
      if (SubstrateError.is(e)) {
        expect(e.code).toBe('not_found');
      }
    }
  });

  it('throws internalError on malformed JSON', async () => {
    await writeFile(join(root, 'config.json'), '{ not valid json', 'utf-8');
    try {
      await readConfig(root);
      throw new Error('expected throw');
    } catch (e) {
      expect(SubstrateError.is(e)).toBe(true);
      if (SubstrateError.is(e)) {
        expect(e.code).toBe('internal_error');
        expect(e.message).toMatch(/malformed/i);
      }
    }
  });

  it('throws internalError on JSON that does not match shape', async () => {
    await writeFile(
      join(root, 'config.json'),
      JSON.stringify({ project_id: 'not-a-uuid', project_name: '', schema_version: 0 }),
      'utf-8',
    );
    try {
      await readConfig(root);
      throw new Error('expected throw');
    } catch (e) {
      expect(SubstrateError.is(e)).toBe(true);
      if (SubstrateError.is(e)) {
        expect(e.code).toBe('internal_error');
        expect(e.details).toBeDefined();
      }
    }
  });
});

describe('writeConfig validation', () => {
  let root: string;
  beforeEach(async () => {
    root = await makeTempRoot();
  });

  it('rejects an invalid Config at write time', async () => {
    const bad = { ...validConfig, project_id: 'not-a-uuid' } as Config;
    await expect(writeConfig(root, bad)).rejects.toThrow();
  });
});
