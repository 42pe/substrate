import { describe, it, expect } from 'vitest';
import { validateSubstrate, validateBoardStructure, checkTeamIntegrity } from './validator.js';
import type { Board, Config, Group, Member, Policy, Substrate } from '../core/types.js';
import { SubstrateError } from '../core/errors.js';

const CONFIG: Config = {
  project_id: '11111111-1111-4111-8111-111111111111',
  project_name: 'test',
  description: '',
  version: 1,
  schema_version: 2,
  created_at: '2026-05-09T00:00:00.000Z',
};

function makeGroup(overrides: Partial<Group> = {}): Group {
  return {
    id: 'g1',
    name: 'Group 1',
    description: '',
    position: 0,
    color: null,
    version: 1,
    archived_at: null,
    ...overrides,
  };
}

function makePolicy(overrides: Partial<Policy> = {}): Policy {
  return {
    id: 'p1',
    name: 'Policy 1',
    description: '',
    type: 'transition_guard',
    definition: { from_group: '*', to_group: '*' },
    priority: 0,
    enabled: true,
    version: 1,
    created_by_agent: 'tester',
    created_at: '2026-05-09T00:00:00.000Z',
    updated_at: '2026-05-09T00:00:00.000Z',
    archived_at: null,
    ...overrides,
  };
}

function makeBoard(overrides: Partial<Board> = {}): Board {
  return {
    id: 'board-1',
    name: 'Board 1',
    description: '',
    field_schema: { task: {}, comments: {} },
    groups: [makeGroup()],
    policies: [],
    version: 1,
    created_at: '2026-05-09T00:00:00.000Z',
    updated_at: '2026-05-09T00:00:00.000Z',
    archived_at: null,
    ...overrides,
  };
}

function sub(boards: Board[], members: Member[] = []): Substrate {
  return { config: CONFIG, boards, members, warnings: [] };
}

describe('validateSubstrate', () => {
  it('accepts a well-formed substrate', () => {
    expect(() => validateSubstrate(sub([makeBoard()]))).not.toThrow();
  });

  it('rejects duplicate board IDs across boards', () => {
    let caught: unknown;
    try {
      validateSubstrate(sub([makeBoard({ id: 'dup' }), makeBoard({ id: 'dup' })]));
    } catch (e) {
      caught = e;
    }
    expect(SubstrateError.is(caught)).toBe(true);
    if (SubstrateError.is(caught)) {
      expect(caught.code).toBe('substrate_corrupt');
      expect(caught.details).toMatchObject({ board_id: 'dup' });
    }
  });

  it('rejects duplicate group IDs within a board', () => {
    const board = makeBoard({ groups: [makeGroup({ id: 'g1' }), makeGroup({ id: 'g1' })] });
    expect(() => validateSubstrate(sub([board]))).toThrow(SubstrateError);
  });

  it('rejects an enum field_schema entry with no values', () => {
    const board = makeBoard({
      field_schema: { task: { sev: { type: 'enum' } }, comments: {} },
    });
    let caught: unknown;
    try {
      validateSubstrate(sub([board]));
    } catch (e) {
      caught = e;
    }
    expect(SubstrateError.is(caught)).toBe(true);
    if (SubstrateError.is(caught)) {
      expect(caught.code).toBe('substrate_corrupt');
      expect(caught.details).toMatchObject({ section: 'task', field: 'sev' });
    }
  });

  it('rejects an enum entry with an empty values array', () => {
    const board = makeBoard({
      field_schema: { task: {}, comments: { tag: { type: 'enum', values: [] } } },
    });
    expect(() => validateSubstrate(sub([board]))).toThrow(SubstrateError);
  });

  it('rejects a transition_guard policy referencing a nonexistent group', () => {
    const board = makeBoard({
      groups: [makeGroup({ id: 'g1' })],
      policies: [makePolicy({ definition: { from_group: 'g1', to_group: 'ghost' } })],
    });
    let caught: unknown;
    try {
      validateSubstrate(sub([board]));
    } catch (e) {
      caught = e;
    }
    expect(SubstrateError.is(caught)).toBe(true);
    if (SubstrateError.is(caught)) {
      expect(caught.code).toBe('substrate_corrupt');
      expect(caught.details).toMatchObject({ policy_id: 'p1', group_id: 'ghost' });
    }
  });

  it("treats '*' as a wildcard, not a group reference", () => {
    const board = makeBoard({
      groups: [makeGroup({ id: 'g1' })],
      policies: [makePolicy({ definition: { from_group: '*', to_group: 'g1' } })],
    });
    expect(() => validateSubstrate(sub([board]))).not.toThrow();
  });

  it('allows a policy referencing an archived group', () => {
    const board = makeBoard({
      groups: [
        makeGroup({ id: 'g1' }),
        makeGroup({ id: 'archived', archived_at: '2026-05-10T00:00:00.000Z' }),
      ],
      policies: [makePolicy({ definition: { from_group: 'g1', to_group: 'archived' } })],
    });
    expect(() => validateSubstrate(sub([board]))).not.toThrow();
  });

  it('does not group-ref-check non-transition_guard policies', () => {
    const board = makeBoard({
      policies: [makePolicy({ type: 'agent_responsibility', definition: { message: 'note' } })],
    });
    expect(() => validateSubstrate(sub([board]))).not.toThrow();
  });

  it('rejects a malformed guard definition on load (substrate_corrupt)', () => {
    const board = makeBoard({
      policies: [makePolicy({ definition: { from_group: 'g1' } })], // missing to_group
    });
    try {
      validateSubstrate(sub([board]));
      throw new Error('expected throw');
    } catch (e) {
      expect(SubstrateError.is(e) && e.code).toBe('substrate_corrupt');
    }
  });

  it('rejects an agent_responsibility with no message on load (substrate_corrupt)', () => {
    const board = makeBoard({
      policies: [makePolicy({ type: 'agent_responsibility', definition: {} })],
    });
    try {
      validateSubstrate(sub([board]));
      throw new Error('expected throw');
    } catch (e) {
      expect(SubstrateError.is(e) && e.code).toBe('substrate_corrupt');
    }
  });
});

describe('member/team integrity — advisory warnings, never errors (load path)', () => {
  const member = (id: string, name = id): Member => ({ id, name });

  it('warns on a team member not in the registry; the substrate still validates', () => {
    const board = makeBoard({ team: [{ member: 'ghost', groups: ['g1'] }] });
    const s = sub([board], []);
    expect(() => validateSubstrate(s)).not.toThrow();
    expect(s.warnings.some((w) => w.includes("member 'ghost'"))).toBe(true);
  });

  it('does NOT warn when the team member resolves', () => {
    const board = makeBoard({ team: [{ member: 'planner', groups: ['g1'] }] });
    const s = sub([board], [member('planner')]);
    validateSubstrate(s);
    expect(s.warnings).toEqual([]);
  });

  it('warns on a groups id that is not a group on the board', () => {
    const board = makeBoard({ team: [{ member: 'planner', groups: ['ghost'] }] });
    const s = sub([board], [member('planner')]);
    validateSubstrate(s);
    expect(s.warnings.some((w) => w.includes("group 'ghost'"))).toBe(true);
  });

  it('does NOT warn on a groups id pointing at an archived group', () => {
    const board = makeBoard({
      groups: [
        makeGroup({ id: 'g1' }),
        makeGroup({ id: 'old', archived_at: '2026-05-10T00:00:00.000Z' }),
      ],
      team: [{ member: 'planner', groups: ['old'] }],
    });
    const s = sub([board], [member('planner')]);
    validateSubstrate(s);
    expect(s.warnings).toEqual([]);
  });

  it('warns on a duplicate member id in the registry', () => {
    const s = sub([makeBoard()], [member('dup'), member('dup')]);
    validateSubstrate(s);
    expect(s.warnings.some((w) => w.includes("Duplicate member id 'dup'"))).toBe(true);
  });

  it('warns on a duplicate member within one board team', () => {
    const board = makeBoard({
      team: [{ member: 'planner' }, { member: 'planner' }],
    });
    const s = sub([board], [member('planner')]);
    validateSubstrate(s);
    expect(s.warnings.some((w) => w.includes('more than once'))).toBe(true);
  });

  it('is inert: a board with a valid team never affects the load outcome', () => {
    const board = makeBoard({ team: [{ member: 'planner', groups: ['g1'] }] });
    expect(() => validateSubstrate(sub([board], [member('planner')]))).not.toThrow();
  });
});

describe('checkTeamIntegrity + validateBoardStructure (write path — same warnings, never throws)', () => {
  it('a dangling team member yields a WARNING (not an error) on the write path', () => {
    const board = makeBoard({ team: [{ member: 'ghost', groups: ['g1'] }] });
    const warnings: string[] = [];
    // validateBoardStructure with teamCtx must NOT throw for a team problem…
    expect(() =>
      validateBoardStructure(board, {
        memberIds: new Set<string>(),
        warn: (w) => warnings.push(w),
      }),
    ).not.toThrow();
    // …and it produces the SAME advisory the load path does.
    expect(warnings.some((w) => w.includes("member 'ghost'"))).toBe(true);
  });

  it('checkTeamIntegrity is a no-op for an empty/absent team', () => {
    const warnings: string[] = [];
    checkTeamIntegrity(makeBoard(), new Set<string>(), (w) => warnings.push(w));
    expect(warnings).toEqual([]);
  });

  it('still enforces structural checks (duplicate group) even with a valid team', () => {
    const board = makeBoard({
      groups: [makeGroup({ id: 'g1' }), makeGroup({ id: 'g1' })],
      team: [{ member: 'planner' }],
    });
    expect(() =>
      validateBoardStructure(board, { memberIds: new Set(['planner']), warn: () => {} }),
    ).toThrow(SubstrateError);
  });
});

describe('validateBoardStructure (write-path → schema_violation)', () => {
  it('accepts a clean board', () => {
    expect(() => validateBoardStructure(makeBoard())).not.toThrow();
  });

  it('rejects a duplicate group id with schema_violation', () => {
    const board = makeBoard({ groups: [makeGroup({ id: 'g1' }), makeGroup({ id: 'g1' })] });
    let caught: unknown;
    try {
      validateBoardStructure(board);
    } catch (e) {
      caught = e;
    }
    expect(SubstrateError.is(caught)).toBe(true);
    if (SubstrateError.is(caught)) expect(caught.code).toBe('schema_violation');
  });

  it('rejects an enum field_schema entry without values (schema_violation)', () => {
    const board = makeBoard({ field_schema: { task: { sev: { type: 'enum' } }, comments: {} } });
    let caught: unknown;
    try {
      validateBoardStructure(board);
    } catch (e) {
      caught = e;
    }
    expect(SubstrateError.is(caught)).toBe(true);
    if (SubstrateError.is(caught)) expect(caught.code).toBe('schema_violation');
  });
});
