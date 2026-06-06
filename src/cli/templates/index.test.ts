import { describe, it, expect } from 'vitest';
import { isTemplateName, templateNames, loadTemplateBoard } from './index.js';
import { BoardSchema } from '../../substrate/schemas.js';

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
});
