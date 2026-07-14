import { describe, it, expect } from 'vitest';
import { listBoardsHandler } from './list-boards.js';
import type { ToolDeps } from '../../deps.js';
import type { Board, Config } from '../../../core/types.js';

const fixtureConfig: Config = {
  project_id: '00000000-0000-4000-8000-000000000001',
  project_name: 'TestProject',
  description: '',
  version: 1,
  schema_version: 2,
  created_at: '2026-05-09T00:00:00.000Z',
};

function makeBoard(id: string, archived = false): Board {
  return {
    id,
    name: `Board ${id}`,
    description: '',
    field_schema: { task: {}, comments: {} },
    groups: [],
    policies: [],
    version: 1,
    created_at: '2026-05-09T00:00:00.000Z',
    updated_at: '2026-05-09T00:00:00.000Z',
    archived_at: archived ? '2026-05-10T00:00:00.000Z' : null,
  };
}

function depsWith(boards: Board[]): ToolDeps {
  return {
    client: {} as ToolDeps['client'],
    config: fixtureConfig,
    loadSubstrate: () =>
      Promise.resolve({ config: fixtureConfig, boards, members: [], warnings: [] }),
    root: '/tmp/substrate-test',
  };
}

describe('listBoardsHandler', () => {
  it('returns all boards as summaries, sorted by id', async () => {
    const r = await listBoardsHandler({}, depsWith([makeBoard('b'), makeBoard('a')]));
    expect(r.results.map((b) => b.id)).toEqual(['a', 'b']);
    expect(r.results[0]).toEqual({
      id: 'a',
      name: 'Board a',
      description: '',
      archived_at: null,
      version: 1,
    });
  });

  it('filters to active only when archived:false', async () => {
    const r = await listBoardsHandler(
      { archived: false },
      depsWith([makeBoard('a'), makeBoard('b', true)]),
    );
    expect(r.results.map((b) => b.id)).toEqual(['a']);
  });

  it('filters to archived only when archived:true', async () => {
    const r = await listBoardsHandler(
      { archived: true },
      depsWith([makeBoard('a'), makeBoard('b', true)]),
    );
    expect(r.results.map((b) => b.id)).toEqual(['b']);
  });

  it('paginates with a stable cursor', async () => {
    const boards = ['a', 'b', 'c', 'd'].map((id) => makeBoard(id));
    const deps = depsWith(boards);
    const p1 = await listBoardsHandler({ pagination: { page_size: 2 } }, deps);
    expect(p1.results.map((b) => b.id)).toEqual(['a', 'b']);
    expect(p1.pagination.has_more).toBe(true);
    const p2 = await listBoardsHandler(
      { pagination: { cursor: p1.pagination.next_cursor!, page_size: 2 } },
      deps,
    );
    expect(p2.results.map((b) => b.id)).toEqual(['c', 'd']);
    expect(p2.pagination.has_more).toBe(false);
  });
});
