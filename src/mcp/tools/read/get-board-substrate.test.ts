import { describe, it, expect } from 'vitest';
import { getBoardSubstrateHandler } from './get-board-substrate.js';
import type { ToolDeps } from '../../deps.js';
import type { Board, Config, Member, Substrate } from '../../../core/types.js';
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

function depsFor(substrate: Substrate): ToolDeps {
  return {
    client: {} as ToolDeps['client'],
    config: fixtureConfig,
    loadSubstrate: () => Promise.resolve(substrate),
    root: '/tmp/substrate-test',
  };
}

const deps = depsFor({ config: fixtureConfig, boards: [board], members: [], warnings: [] });

describe('getBoardSubstrateHandler', () => {
  it('returns board, groups, field_schema, policies, and team', async () => {
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
    // A board with no team resolves to [].
    expect(r.team).toEqual([]);
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

describe('getBoardSubstrateHandler — team resolution (registry JOIN)', () => {
  const reviewers: Member = {
    id: 'reviewers',
    name: 'Reviewers ×2',
    traits: ['skeptical'],
    concerns: ['never rubber-stamp'],
    memory_dir: '.substrate/members/reviewers/memory',
  };
  const planner: Member = { id: 'planner', name: 'Planner' };

  const dev: Board = {
    ...board,
    id: 'dev',
    team: [
      { member: 'planner', groups: ['g1'] },
      { member: 'reviewers', groups: ['g1'] },
      { member: 'ghost', groups: ['g1'] }, // unresolved
    ],
  };
  const release: Board = { ...board, id: 'release', team: [{ member: 'reviewers', groups: [] }] };

  const jointDeps = depsFor({
    config: fixtureConfig,
    boards: [dev, release],
    members: [planner, reviewers],
    warnings: [],
  });

  it('JOINs member identity + keeps the binding groups', async () => {
    const r = await getBoardSubstrateHandler({ board_id: 'dev' }, jointDeps);
    const rev = r.team.find((t) => t.member.id === 'reviewers');
    expect(rev).toBeDefined();
    expect(rev!.unresolved).toBe(false);
    if (rev && rev.unresolved === false) {
      expect(rev.member.name).toBe('Reviewers ×2');
      expect(rev.member.traits).toEqual(['skeptical']);
      expect(rev.groups).toEqual(['g1']);
    }
  });

  it('surfaces an unresolved member (bare id + marker), never dropped', async () => {
    const r = await getBoardSubstrateHandler({ board_id: 'dev' }, jointDeps);
    expect(r.team).toHaveLength(3);
    const ghost = r.team.find((t) => t.member.id === 'ghost');
    expect(ghost?.unresolved).toBe(true);
  });

  it('resolves a shared member identically from both boards', async () => {
    const rDev = await getBoardSubstrateHandler({ board_id: 'dev' }, jointDeps);
    const rRel = await getBoardSubstrateHandler({ board_id: 'release' }, jointDeps);
    const devRev = rDev.team.find((t) => t.member.id === 'reviewers');
    const relRev = rRel.team.find((t) => t.member.id === 'reviewers');
    expect(devRev?.unresolved).toBe(false);
    expect(relRev?.unresolved).toBe(false);
    if (devRev?.unresolved === false && relRev?.unresolved === false) {
      expect(relRev.member).toEqual(devRev.member); // same identity
      expect(relRev.groups).toEqual([]); // but board-specific groups differ
    }
  });
});
