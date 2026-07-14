import { describe, it, expect } from 'vitest';
import { isTemplateName, templateNames, loadTemplateBoard, loadTemplateMembers } from './index.js';
import { BoardSchema, MemberSchema } from '../../substrate/schemas.js';

describe('template registry', () => {
  it('lists web-delivery and recognizes it', () => {
    expect(templateNames()).toContain('web-delivery');
    expect(isTemplateName('web-delivery')).toBe(true);
    expect(isTemplateName('bogus')).toBe(false);
  });

  it('loadTemplateBoard returns a BoardSchema-valid board (the parse gate)', () => {
    const board = loadTemplateBoard('web-delivery');
    // loadTemplateBoard MUST run BoardSchema.parse (createBoardFile does not
    // validate) — re-parsing the result must succeed and round-trip.
    expect(() => BoardSchema.parse(board)).not.toThrow();
    expect(board.id).toBe('delivery');
    expect(board.groups).toHaveLength(7);
    expect(board.policies).toHaveLength(8);
  });

  it('returns a fresh mutable object each call (not the readonly const)', () => {
    const a = loadTemplateBoard('web-delivery');
    const b = loadTemplateBoard('web-delivery');
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it('the parse gate (BoardSchema) rejects a corrupt board', () => {
    // loadTemplateBoard relies on BoardSchema.parse as the ONLY validation —
    // createBoardFile writes verbatim. Prove the gate actually rejects garbage.
    expect(() => BoardSchema.parse({ id: 'x', name: 'x' })).toThrow();
    expect(() =>
      BoardSchema.parse({ ...loadTemplateBoard('web-delivery'), groups: 'nope' }),
    ).toThrow();
  });

  it('the bundled board ships a team whose members target real groups', () => {
    const board = loadTemplateBoard('web-delivery');
    expect(board.team?.map((t) => t.member).sort()).toEqual([
      'builder',
      'planner',
      'qa',
      'reviewer',
    ]);
    const groupIds = new Set(board.groups.map((g) => g.id));
    for (const binding of board.team ?? []) {
      for (const g of binding.groups ?? []) expect(groupIds.has(g)).toBe(true);
    }
  });

  it('loadTemplateMembers returns the strictly-validated default registry', () => {
    const members = loadTemplateMembers('web-delivery');
    expect(members.map((m) => m.id).sort()).toEqual(['builder', 'planner', 'qa', 'reviewer']);
    for (const m of members) expect(m.name.length).toBeGreaterThan(0);
  });

  it('the shipped-defaults gate is STRICT: MemberSchema.parse throws on a corrupt member', () => {
    // loadTemplateMembers maps MemberSchema.parse over the shipped defaults, so a
    // corrupt shipped member throws at build/init time — deliberately UNLIKE the
    // lenient runtime loader, which warns + skips a bad user-project member file.
    expect(() => MemberSchema.parse({ id: 'broken' })).toThrow(); // missing name
  });
});
