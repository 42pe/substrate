import { describe, it, expect } from 'vitest';
import { MemberSchema, TeamBindingSchema, BoardSchema } from './schemas.js';

/**
 * Schema-shape tests for the member registry + board team binding. These schemas
 * are used STRICTLY (`.parse`) by the template gate (loadTemplateMembers) and
 * LENIENTLY (`.safeParse`, warn+skip) by the runtime loader — both rely on the
 * shape below.
 */

const baseBoard = {
  id: 'b',
  name: 'B',
  description: '',
  field_schema: { task: {}, comments: {} },
  groups: [],
  policies: [],
  version: 1,
  created_at: '2026-05-09T00:00:00.000Z',
  updated_at: '2026-05-09T00:00:00.000Z',
  archived_at: null,
};

describe('MemberSchema', () => {
  it('parses a full member', () => {
    const r = MemberSchema.safeParse({
      id: 'oversight',
      name: 'Oversight',
      full_description: 'holds the line',
      traits: ['a', 'b'],
      concerns: ['c'],
      memory_dir: '.substrate/members/oversight/memory',
    });
    expect(r.success).toBe(true);
  });

  it('parses a member with only the required id + name', () => {
    const r = MemberSchema.safeParse({ id: 'x', name: 'X' });
    expect(r.success).toBe(true);
  });

  it('rejects a member missing id', () => {
    expect(MemberSchema.safeParse({ name: 'X' }).success).toBe(false);
  });

  it('rejects a member missing name', () => {
    expect(MemberSchema.safeParse({ id: 'x' }).success).toBe(false);
  });

  it('rejects empty id / name', () => {
    expect(MemberSchema.safeParse({ id: '', name: 'X' }).success).toBe(false);
    expect(MemberSchema.safeParse({ id: 'x', name: '' }).success).toBe(false);
  });

  it('rejects wrong-typed traits', () => {
    expect(MemberSchema.safeParse({ id: 'x', name: 'X', traits: 'nope' }).success).toBe(false);
  });
});

describe('TeamBindingSchema', () => {
  it('parses member + groups', () => {
    expect(TeamBindingSchema.safeParse({ member: 'm', groups: ['g1'] }).success).toBe(true);
  });

  it('parses a binding with no groups (optional)', () => {
    expect(TeamBindingSchema.safeParse({ member: 'm' }).success).toBe(true);
  });

  it('parses an empty groups array', () => {
    expect(TeamBindingSchema.safeParse({ member: 'm', groups: [] }).success).toBe(true);
  });

  it('rejects a binding missing member', () => {
    expect(TeamBindingSchema.safeParse({ groups: ['g1'] }).success).toBe(false);
  });
});

describe('BoardSchema.team', () => {
  it('parses a board with a team', () => {
    const r = BoardSchema.safeParse({
      ...baseBoard,
      team: [{ member: 'm', groups: ['g1'] }],
    });
    expect(r.success).toBe(true);
  });

  it('parses a board with no team (optional → backward compatible)', () => {
    const r = BoardSchema.safeParse(baseBoard);
    expect(r.success).toBe(true);
    // The board schema itself parses even for a binding that will later WARN at
    // integrity time (a dangling member is a validator concern, not a parse one).
    const r2 = BoardSchema.safeParse({ ...baseBoard, team: [{ member: 'ghost' }] });
    expect(r2.success).toBe(true);
  });
});
