import { describe, it, expect } from 'vitest';
import { whoamiHandler } from './whoami.js';
import type { ToolDeps } from '../../deps.js';
import type { Config } from '../../../core/types.js';

const fixtureConfig: Config = {
  project_id: '00000000-0000-4000-8000-000000000001',
  project_name: 'TestProject',
  schema_version: 1,
  created_at: '2026-05-09T00:00:00.000Z',
};

// whoami doesn't need a libsql client in Phase 1, but the ToolDeps type
// requires it; use a never-used stub.
const stubDeps: ToolDeps = {
  client: {} as ToolDeps['client'],
  config: fixtureConfig,
};

describe('whoamiHandler', () => {
  it('returns project metadata from config', async () => {
    const result = await whoamiHandler(stubDeps);
    expect(result.project_id).toBe(fixtureConfig.project_id);
    expect(result.project_name).toBe(fixtureConfig.project_name);
    expect(result.schema_version).toBe(fixtureConfig.schema_version);
  });

  it('returns empty boards and hints in Phase 1', async () => {
    const result = await whoamiHandler(stubDeps);
    expect(result.boards).toEqual([]);
    expect(result.hints).toEqual([]);
  });

  it('returns a phase string', async () => {
    const result = await whoamiHandler(stubDeps);
    expect(result.phase).toMatch(/walking skeleton/);
  });

  it('does not leak unexpected fields', async () => {
    const result = await whoamiHandler(stubDeps);
    expect(Object.keys(result).sort()).toEqual([
      'boards',
      'hints',
      'phase',
      'project_id',
      'project_name',
      'schema_version',
    ]);
  });
});
