import { describe, it, expect } from 'vitest';
import { resolve, join } from 'node:path';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { loadSubstrate } from '../../src/substrate/loader.js';
import { loadExternalTemplate } from '../../src/cli/templates/external.js';
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

  // Phase 8: the example is a working shareable template. With its committed
  // substrate-template.json it resolves in MANIFEST mode; the same boards
  // resolve in CONVENTION mode from a manifest-less copy (N1 — don't rename the
  // committed example in place). Both yield the authoritative delivery board.
  const EXAMPLE_DIR = resolve(import.meta.dirname, '..', '..', 'examples', 'web-delivery');
  const authoritative = JSON.parse(readFileSync(resolve(ROOT, 'boards', 'delivery.json'), 'utf-8'));

  it('resolves as a shareable template in MANIFEST mode (committed manifest)', async () => {
    const t = await loadExternalTemplate(EXAMPLE_DIR);
    expect(t.source).toBe('manifest');
    expect(t.manifest?.name).toBe('Web Delivery');
    expect(t.boards.map((b) => b.id)).toEqual(['delivery']);
    expect(JSON.stringify(canonical(t.boards[0]))).toBe(JSON.stringify(canonical(authoritative)));
  });

  it('resolves the same board in CONVENTION mode from a manifest-less copy', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'wd-convention-'));
    try {
      const bdir = join(tmp, '.substrate', 'boards');
      mkdirSync(bdir, { recursive: true });
      writeFileSync(join(bdir, 'delivery.json'), JSON.stringify(authoritative));
      const t = await loadExternalTemplate(tmp);
      expect(t.source).toBe('convention');
      expect(JSON.stringify(canonical(t.boards[0]))).toBe(JSON.stringify(canonical(authoritative)));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
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
