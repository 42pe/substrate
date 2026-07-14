import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { loadSubstrate } from '../../src/substrate/loader.js';
import { getBoardSubstrateHandler } from '../../src/mcp/tools/read/get-board-substrate.js';
import type { ToolDeps } from '../../src/mcp/deps.js';

/**
 * Migration fidelity for the two LIVE boards (dev + release): the `## Team` prose
 * became a project-level member registry + per-board `team` bindings, with
 * `reviewers` a single shared file bound by both boards. Guards against roster
 * loss, prose leftovers, and integrity regressions.
 */
const ROOT = resolve(import.meta.dirname, '..', '..', '.substrate');

async function load() {
  return loadSubstrate(ROOT);
}

function depsFor(root: string): ToolDeps {
  return {
    client: {} as ToolDeps['client'],
    config: {} as ToolDeps['config'],
    loadSubstrate: () => loadSubstrate(root),
    root,
  };
}

describe('live board team migration (dev + release)', () => {
  it('loads with zero integrity warnings', async () => {
    const s = await load();
    expect(s.warnings).toEqual([]);
  });

  it('the ## Team prose is removed from both board descriptions', async () => {
    const s = await load();
    for (const id of ['dev', 'release']) {
      const b = s.boards.find((x) => x.id === id);
      expect(b, `board ${id} present`).toBeDefined();
      expect(b!.description).not.toContain('## Team');
    }
  });

  it('the registry holds every migrated role, reviewers shared (one file)', async () => {
    const s = await load();
    expect(s.members.map((m) => m.id).sort()).toEqual([
      'builder',
      'doc-auditor',
      'integrator',
      'planner',
      'release-engineer',
      'reviewers',
      'validator',
    ]);
  });

  it('dev board bindings resolve with the expected groups', async () => {
    const r = await getBoardSubstrateHandler({ board_id: 'dev' }, depsFor(ROOT));
    const byId = new Map(r.team.map((t) => [t.member.id, t]));
    expect([...byId.keys()].sort()).toEqual(['builder', 'integrator', 'planner', 'reviewers']);
    for (const t of r.team) expect(t.unresolved).toBe(false);
    expect(byId.get('planner')!.groups).toEqual(['spec']);
    expect(byId.get('builder')!.groups).toEqual(['build']);
    expect(byId.get('reviewers')!.groups).toEqual(['review']);
    expect(byId.get('integrator')!.groups).toEqual(['approval', 'merged']);
  });

  it('release board bindings resolve with the expected groups', async () => {
    const r = await getBoardSubstrateHandler({ board_id: 'release' }, depsFor(ROOT));
    const byId = new Map(r.team.map((t) => [t.member.id, t]));
    expect([...byId.keys()].sort()).toEqual([
      'doc-auditor',
      'release-engineer',
      'reviewers',
      'validator',
    ]);
    for (const t of r.team) expect(t.unresolved).toBe(false);
    expect(byId.get('doc-auditor')!.groups).toEqual(['docs']);
    expect(byId.get('release-engineer')!.groups).toEqual(['versioned', 'released']);
    expect(byId.get('validator')!.groups).toEqual(['validated']);
    expect(byId.get('reviewers')!.groups).toEqual([]); // no dedicated group
  });

  it('the shared reviewers member resolves to the SAME identity from both boards', async () => {
    const dev = await getBoardSubstrateHandler({ board_id: 'dev' }, depsFor(ROOT));
    const rel = await getBoardSubstrateHandler({ board_id: 'release' }, depsFor(ROOT));
    const devRev = dev.team.find((t) => t.member.id === 'reviewers');
    const relRev = rel.team.find((t) => t.member.id === 'reviewers');
    expect(devRev?.unresolved).toBe(false);
    expect(relRev?.unresolved).toBe(false);
    if (devRev?.unresolved === false && relRev?.unresolved === false) {
      expect(relRev.member).toEqual(devRev.member);
      expect(relRev.member.name).toBe('Reviewers ×2'); // Unicode round-trips
    }
  });
});
