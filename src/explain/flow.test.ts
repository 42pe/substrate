import { describe, it, expect } from 'vitest';
import { buildFlowModel, ANY_NODE_ID } from './flow.js';
import type { Board, Group, Policy } from '../core/types.js';

const TS = '2026-01-01T00:00:00.000Z';

function group(id: string, position: number, archived = false): Group {
  return {
    id,
    name: id,
    description: '',
    position,
    color: null,
    version: 1,
    archived_at: archived ? TS : null,
  };
}

function guard(
  id: string,
  from: string,
  to: string,
  require: unknown[] = [],
  priority = 0,
): Policy {
  return {
    id,
    name: id,
    description: '',
    type: 'transition_guard',
    definition: { from_group: from, to_group: to, require, on_failure_message: `block ${id}` },
    priority,
    enabled: true,
    version: 1,
    created_by_agent: 't',
    created_at: TS,
    updated_at: TS,
    archived_at: null,
  };
}

function resp(id: string, when: unknown[], message: string): Policy {
  return {
    id,
    name: id,
    description: message,
    type: 'agent_responsibility',
    definition: { when, message },
    priority: 0,
    enabled: true,
    version: 1,
    created_by_agent: 't',
    created_at: TS,
    updated_at: TS,
    archived_at: null,
  };
}

function board(groups: Group[], policies: Policy[] = []): Board {
  return {
    id: 'b',
    name: 'B',
    description: '',
    field_schema: { task: {}, comments: {} },
    groups,
    policies,
    version: 1,
    created_at: TS,
    updated_at: TS,
    archived_at: null,
  };
}

const edge = (m: ReturnType<typeof buildFlowModel>, from: string, to: string, kind?: string) =>
  m.edges.find((e) => e.from === from && e.to === to && (kind ? e.kind === kind : true));

describe('buildFlowModel — edge derivation', () => {
  it('rule 1: sequential backbone between consecutive non-archived groups', () => {
    const m = buildFlowModel(board([group('a', 0), group('b', 1), group('c', 2)]));
    expect(m.edges.map((e) => `${e.from}->${e.to}:${e.kind}`)).toEqual([
      'a->b:backbone',
      'b->c:backbone',
    ]);
  });

  it('rule 2: a concrete guard REPLACES the adjacent backbone edge (no double edge)', () => {
    const m = buildFlowModel(board([group('a', 0), group('b', 1)], [guard('g', 'a', 'b')]));
    expect(m.edges).toHaveLength(1);
    expect(edge(m, 'a', 'b', 'guard')).toBeTruthy();
    expect(edge(m, 'a', 'b', 'backbone')).toBeUndefined();
  });

  it('rule 2: multiple guards on one edge collapse to ONE "N gates" edge', () => {
    const m = buildFlowModel(
      board([group('a', 0), group('b', 1)], [guard('g1', 'a', 'b'), guard('g2', 'a', 'b')]),
    );
    const e = edge(m, 'a', 'b', 'guard');
    expect(e?.label).toBe('2 gates');
    expect(m.edges.filter((x) => x.from === 'a' && x.to === 'b')).toHaveLength(1);
  });

  it('rule 2: a non-adjacent concrete guard is a truthful long edge; backbone still connects neighbors', () => {
    const m = buildFlowModel(
      board([group('a', 0), group('b', 1), group('c', 2)], [guard('g', 'a', 'c')]),
    );
    expect(edge(m, 'a', 'b', 'backbone')).toBeTruthy();
    expect(edge(m, 'b', 'c', 'backbone')).toBeTruthy();
    expect(edge(m, 'a', 'c', 'guard')).toBeTruthy();
  });

  it('rule 2: a guard referencing a missing group draws no edge', () => {
    const m = buildFlowModel(board([group('a', 0), group('b', 1)], [guard('g', 'a', 'ghost')]));
    expect(m.edges.some((e) => e.to === 'ghost')).toBe(false);
  });

  it('rule 3: a wildcard "* -> done" is ONE gate annotation, not an edge from every node', () => {
    const m = buildFlowModel(
      board([group('a', 0), group('b', 1), group('done', 2)], [guard('gate', '*', 'done')]),
    );
    const wild = m.edges.filter((e) => e.kind === 'wildcard');
    expect(wild).toHaveLength(1);
    expect(wild[0]).toMatchObject({ from: ANY_NODE_ID, to: 'done' });
    expect(m.nodes.find((n) => n.id === 'done')?.gated).toBe(true);
    expect(m.hasAny).toBe(true);
  });

  it('rule 4: a group_id responsibility attaches to its node; others go to the conditional list', () => {
    const m = buildFlowModel(
      board(
        [group('a', 0), group('b', 1)],
        [
          resp('r1', [{ field: 'task.group_id', op: 'eq', value: 'a' }], 'do X in a'),
          resp('r2', [{ field: 'task.scope', op: 'eq', value: 'user_facing' }], 'docs'),
        ],
      ),
    );
    expect(m.nodes.find((n) => n.id === 'a')?.suggestions).toContain('r1');
    expect(m.conditionalSuggestions.map((c) => c.policyName)).toEqual(['r2']);
  });

  it('archived groups are off the backbone but still rendered', () => {
    const m = buildFlowModel(board([group('a', 0), group('b', 1), group('x', 2, true)]));
    expect(m.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(m.archivedNodes.map((n) => n.id)).toEqual(['x']);
    expect(m.edges.some((e) => e.to === 'x' || e.from === 'x')).toBe(false);
  });

  it('a guard targeting an ARCHIVED group draws no edge (no orphan/drop)', () => {
    const m = buildFlowModel(
      board(
        [group('a', 0), group('done', 1, true)],
        [guard('w', '*', 'done'), guard('c', 'a', 'done')],
      ),
    );
    expect(m.edges.some((e) => e.to === 'done')).toBe(false);
    expect(m.hasAny).toBe(false); // no live wildcard target → no synthetic "any" box
    expect(m.archivedNodes.map((n) => n.id)).toEqual(['done']);
  });
});
