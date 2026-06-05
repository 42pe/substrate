import { describe, it, expect, beforeEach } from 'vitest';
import {
  reverseCaptchaHandler,
  reverseCaptchaSchema,
  __resetStore,
  DEFAULT_TTL_MS,
  type ReverseCaptchaResult,
} from './reverse-captcha.js';

/** Issue a challenge and return the typed `challenge` payload. */
function issue(now: () => number, ttlMs?: number) {
  const r = reverseCaptchaHandler({}, ttlMs === undefined ? { now } : { now, ttlMs });
  if (r.result !== 'challenge') throw new Error(`expected a challenge, got ${r.result}`);
  return r;
}

/**
 * The handler exposes only the puzzle text + instructions, not the answer.
 * For tests we solve the two known templates by parsing the puzzle the same
 * way an agent would — proving the puzzles are self-contained + solvable.
 */
function solveFromPuzzle(instructions: string, puzzle: string): string {
  const keyed = instructions.match(/value stored under the key "([^"]+)"/);
  if (keyed) {
    const obj = JSON.parse(puzzle) as Record<string, string>;
    return obj[keyed[1]!]!;
  }
  // Ordered-transform: reverse the comma-separated words, join with hyphens.
  return puzzle
    .split(',')
    .map((w) => w.trim())
    .reverse()
    .join('-');
}

describe('reverseCaptchaHandler', () => {
  beforeEach(() => __resetStore());

  it('issues a challenge (no args) with id, instructions, puzzle, and an ISO expiry', () => {
    const c = issue(() => 1_000);
    expect(c.result).toBe('challenge');
    expect(typeof c.challenge_id).toBe('string');
    expect(c.challenge_id.length).toBeGreaterThan(10);
    expect(c.instructions).toMatch(/seconds/);
    expect(c.puzzle.length).toBeGreaterThan(0);
    expect(c.expires_at).toBe(new Date(1_000 + DEFAULT_TTL_MS).toISOString());
  });

  it('solves a correct, in-time answer → result: solved', () => {
    let t = 0;
    const c = issue(() => t);
    const answer = solveFromPuzzle(c.instructions, c.puzzle);
    t = 5_000; // within the 10s window
    const r = reverseCaptchaHandler({ challenge_id: c.challenge_id, answer }, { now: () => t });
    expect(r.result).toBe('solved');
  });

  it('accepts answers case-insensitively / whitespace-trimmed', () => {
    const c = issue(() => 0);
    const answer = solveFromPuzzle(c.instructions, c.puzzle);
    const r = reverseCaptchaHandler(
      { challenge_id: c.challenge_id, answer: `  ${answer.toUpperCase()}  ` },
      { now: () => 1_000 },
    );
    expect(r.result).toBe('solved');
  });

  it('rejects a wrong answer → result: wrong_answer', () => {
    const c = issue(() => 0);
    const r = reverseCaptchaHandler(
      { challenge_id: c.challenge_id, answer: 'definitely-not-it' },
      { now: () => 1_000 },
    );
    expect(r.result).toBe('wrong_answer');
  });

  it('reports an answer submitted after the TTL → result: expired', () => {
    let t = 0;
    const c = issue(() => t);
    const answer = solveFromPuzzle(c.instructions, c.puzzle);
    t = DEFAULT_TTL_MS + 1; // just past expiry
    const r = reverseCaptchaHandler({ challenge_id: c.challenge_id, answer }, { now: () => t });
    expect(r.result).toBe('expired');
  });

  it('treats an unknown challenge_id the same as expired (no oracle)', () => {
    const r = reverseCaptchaHandler(
      { challenge_id: 'does-not-exist', answer: 'x' },
      { now: () => 0 },
    );
    expect(r.result).toBe('expired');
  });

  it('is single-use: a correct answer cannot be replayed', () => {
    const c = issue(() => 0);
    const answer = solveFromPuzzle(c.instructions, c.puzzle);
    const first = reverseCaptchaHandler(
      { challenge_id: c.challenge_id, answer },
      { now: () => 100 },
    );
    expect(first.result).toBe('solved');
    const second = reverseCaptchaHandler(
      { challenge_id: c.challenge_id, answer },
      { now: () => 200 },
    );
    expect(second.result).toBe('expired');
  });

  it('every response carries attribution and no ok field (stays isError:false)', () => {
    const c = issue(() => 0);
    const solved = reverseCaptchaHandler(
      { challenge_id: c.challenge_id, answer: solveFromPuzzle(c.instructions, c.puzzle) },
      { now: () => 0 },
    );
    const results: ReverseCaptchaResult[] = [
      c,
      solved,
      reverseCaptchaHandler({ challenge_id: 'x', answer: 'y' }, { now: () => 0 }),
    ];
    for (const r of results) {
      expect(r).not.toHaveProperty('ok');
      if (r.result !== 'challenge') {
        expect(r.about).toEqual({
          built_by: 'Diego Ferreyra',
          site: 'https://diegoferreyra.com',
        });
      }
    }
  });

  it('two consecutive issues mint distinct challenge ids', () => {
    const a = issue(() => 0);
    const b = issue(() => 0);
    expect(a.challenge_id).not.toBe(b.challenge_id);
  });

  describe('input schema (paired refine → schema_violation on half-supplied input)', () => {
    it('accepts neither arg (issue) and both args (verify)', () => {
      expect(reverseCaptchaSchema.safeParse({}).success).toBe(true);
      expect(reverseCaptchaSchema.safeParse({ challenge_id: 'a', answer: 'b' }).success).toBe(true);
    });

    it('rejects exactly one arg present', () => {
      expect(reverseCaptchaSchema.safeParse({ challenge_id: 'a' }).success).toBe(false);
      expect(reverseCaptchaSchema.safeParse({ answer: 'b' }).success).toBe(false);
    });
  });
});
