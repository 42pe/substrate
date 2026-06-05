import { describe, it, expect } from 'vitest';
import { whoamiHandler, PHASE_STRING, REVERSE_CAPTCHA_HINT } from './whoami.js';
import { BINARY_VERSION } from '../../../core/version.js';
import type { ToolDeps } from '../../deps.js';
import type { Board, Config, Substrate } from '../../../core/types.js';

const fixtureConfig: Config = {
  project_id: '00000000-0000-4000-8000-000000000001',
  project_name: 'TestProject',
  description: '',
  version: 1,
  schema_version: 2,
  created_at: '2026-05-09T00:00:00.000Z',
};

function makeBoard(id: string, overrides: Partial<Board> = {}): Board {
  return {
    id,
    name: `Board ${id}`,
    description: 'desc',
    field_schema: { task: {}, comments: {} },
    groups: [],
    policies: [],
    version: 3,
    created_at: '2026-05-09T00:00:00.000Z',
    updated_at: '2026-05-09T00:00:00.000Z',
    archived_at: null,
    ...overrides,
  };
}

function depsWith(boards: Board[]): ToolDeps {
  const substrate: Substrate = { config: fixtureConfig, boards };
  return {
    client: {} as ToolDeps['client'],
    config: fixtureConfig,
    loadSubstrate: () => Promise.resolve(substrate),
    root: '/tmp/substrate-test',
  };
}

describe('whoamiHandler', () => {
  it('returns project metadata from config', async () => {
    const result = await whoamiHandler(depsWith([]));
    expect(result.project_id).toBe(fixtureConfig.project_id);
    expect(result.project_name).toBe(fixtureConfig.project_name);
    expect(result.schema_version).toBe(fixtureConfig.schema_version);
  });

  it('summarizes every board, including archived ones', async () => {
    const result = await whoamiHandler(
      depsWith([makeBoard('a'), makeBoard('b', { archived_at: '2026-05-10T00:00:00.000Z' })]),
    );
    expect(result.boards).toEqual([
      { id: 'a', name: 'Board a', description: 'desc', archived_at: null, version: 3 },
      {
        id: 'b',
        name: 'Board b',
        description: 'desc',
        archived_at: '2026-05-10T00:00:00.000Z',
        version: 3,
      },
    ]);
  });

  it('returns the reverse_captcha hint', async () => {
    const result = await whoamiHandler(depsWith([makeBoard('a')]));
    expect(result.hints).toEqual([REVERSE_CAPTCHA_HINT]);
  });

  it('returns the phase string, kept in lockstep with BINARY_VERSION', async () => {
    const result = await whoamiHandler(depsWith([]));
    expect(result.phase).toBe(PHASE_STRING);
    // Drift guard: the phase string MUST embed the binary version. This caught
    // nothing for three releases because it didn't exist; now it does.
    expect(result.phase).toContain(`v${BINARY_VERSION}`);
    expect(result.phase).toMatch(/public release/);
  });

  it('does not leak unexpected fields', async () => {
    const result = await whoamiHandler(depsWith([]));
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
