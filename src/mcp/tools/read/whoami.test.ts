import { describe, it, expect } from 'vitest';
import { whoamiHandler, PHASE_STRING } from './whoami.js';
import type { ToolDeps } from '../../deps.js';
import type { Board, Config, Substrate } from '../../../core/types.js';

const fixtureConfig: Config = {
  project_id: '00000000-0000-4000-8000-000000000001',
  project_name: 'TestProject',
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

  it('returns empty hints in Phase 2', async () => {
    const result = await whoamiHandler(depsWith([makeBoard('a')]));
    expect(result.hints).toEqual([]);
  });

  it('returns the Phase 2 phase string', async () => {
    const result = await whoamiHandler(depsWith([]));
    expect(result.phase).toBe(PHASE_STRING);
    expect(result.phase).toMatch(/storage \+ reads \+ writes/);
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
