import { describe, it, expect } from 'vitest';
import { getBoardSubstrateHandler } from './get-board-substrate.js';
import type { ToolDeps } from '../../deps.js';
import type { Board, Config } from '../../../core/types.js';
import { SubstrateError } from '../../../core/errors.js';

const fixtureConfig: Config = {
  project_id: '00000000-0000-4000-8000-000000000001',
  project_name: 'TestProject',
  description: '',
  version: 1,
  schema_version: 2,
  created_at: '2026-05-09T00:00:00.000Z',
};

const board: Board = {
  id: 'board-1',
  name: 'Board 1',
  description: 'the board',
  field_schema: {
    task: { severity: { type: 'enum', values: ['low', 'high'] } },
    comments: {},
  },
  groups: [
    {
      id: 'g1',
      name: 'Todo',
      description: '',
      position: 0,
      color: null,
      version: 1,
      archived_at: null,
    },
  ],
  policies: [],
  version: 4,
  created_at: '2026-05-09T00:00:00.000Z',
  updated_at: '2026-05-09T00:00:00.000Z',
  archived_at: null,
};

const deps: ToolDeps = {
  client: {} as ToolDeps['client'],
  config: fixtureConfig,
  loadSubstrate: () => Promise.resolve({ config: fixtureConfig, boards: [board] }),
  root: '/tmp/substrate-test',
};

describe('getBoardSubstrateHandler', () => {
  it('returns board, groups, field_schema, and policies', async () => {
    const r = await getBoardSubstrateHandler({ board_id: 'board-1' }, deps);
    expect(r.board).toEqual({
      id: 'board-1',
      name: 'Board 1',
      description: 'the board',
      version: 4,
      created_at: '2026-05-09T00:00:00.000Z',
      updated_at: '2026-05-09T00:00:00.000Z',
      archived_at: null,
    });
    expect(r.groups).toHaveLength(1);
    expect(r.field_schema.task.severity).toEqual({ type: 'enum', values: ['low', 'high'] });
    expect(r.policies).toEqual([]);
  });

  it('throws not_found for an unknown board', async () => {
    let caught: unknown;
    try {
      await getBoardSubstrateHandler({ board_id: 'ghost' }, deps);
    } catch (e) {
      caught = e;
    }
    expect(SubstrateError.is(caught)).toBe(true);
    if (SubstrateError.is(caught)) {
      expect(caught.code).toBe('not_found');
      expect(caught.details).toEqual({ entity: 'board', id: 'ghost' });
    }
  });
});
