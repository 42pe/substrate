import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { loadSubstrate } from '../../src/substrate/loader.js';
import { runTransitionGuards, runAgentResponsibilities } from '../../src/policy/engine.js';
import { WEB_DELIVERY_BOARD } from '../../src/cli/templates/web-delivery.board.js';
import type { Board } from '../../src/core/types.js';
import type { EvalContext } from '../../src/policy/types.js';

/** Order-independent canonicalization for parse-equality. */
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, val]) => [k, canonical(val)]),
    );
  }
  return v;
}

/**
 * Validates the shipped example substrate in `examples/web-delivery/`: it must
 * load (Zod + integrity) AND its policy gates must actually engage/block/pass.
 * Guards the template against silent rot.
 */
const ROOT = resolve(import.meta.dirname, '..', '..', 'examples', 'web-delivery', '.substrate');

function task(group_id: string, custom: Record<string, unknown>): EvalContext {
  return { task: { group_id, custom_data: custom } };
}

describe('example substrate — web-delivery', () => {
  it('loads cleanly (schema + integrity)', async () => {
    const substrate = await loadSubstrate(ROOT);
    expect(substrate.boards.map((b) => b.id)).toContain('delivery');
  });

  it('the bundled .ts template is parse-equal to the example JSON (no drift)', () => {
    const json = JSON.parse(readFileSync(resolve(ROOT, 'boards', 'delivery.json'), 'utf-8'));
    expect(JSON.stringify(canonical(WEB_DELIVERY_BOARD))).toBe(JSON.stringify(canonical(json)));
  });

  async function board(): Promise<Board> {
    const substrate = await loadSubstrate(ROOT);
    const b = substrate.boards.find((x) => x.id === 'delivery');
    if (!b) throw new Error('delivery board missing');
    return b;
  }

  it('blocks spec → plan until spec_approved, then allows it', async () => {
    const b = await board();
    expect(() =>
      runTransitionGuards({
        board: b,
        fromGroup: 'spec',
        toGroup: 'plan',
        candidate: task('plan', { spec_approved: false }),
      }),
    ).toThrow(/spec must be approved/i);

    expect(() =>
      runTransitionGuards({
        board: b,
        fromGroup: 'spec',
        toGroup: 'plan',
        candidate: task('plan', { spec_approved: true }),
      }),
    ).not.toThrow();
  });

  it('the Done gate requires tests + review + audit (wildcard from any stage)', async () => {
    const b = await board();
    expect(() =>
      runTransitionGuards({
        board: b,
        fromGroup: 'qa',
        toGroup: 'done',
        candidate: task('done', { tests_passing: true, review_cleared: true, audited: false }),
      }),
    ).toThrow(/Done requires/i);

    expect(() =>
      runTransitionGuards({
        board: b,
        fromGroup: 'qa',
        toGroup: 'done',
        candidate: task('done', { tests_passing: true, review_cleared: true, audited: true }),
      }),
    ).not.toThrow();
  });

  it('surfaces the "write tests" suggestion while In Progress', async () => {
    const b = await board();
    const fired = runAgentResponsibilities({ board: b, state: task('in_progress', {}) });
    expect(fired.map((f) => f.policy_id)).toContain('note-tests-during-dev');
    expect(fired.find((f) => f.policy_id === 'note-tests-during-dev')?.message).toMatch(/tests/i);
  });

  it('surfaces the docs-in-sync suggestion for user_facing scope', async () => {
    const b = await board();
    const fired = runAgentResponsibilities({
      board: b,
      state: task('in_progress', { scope: 'user_facing' }),
    });
    expect(fired.map((f) => f.policy_id)).toContain('note-docs-in-sync');
  });
});
