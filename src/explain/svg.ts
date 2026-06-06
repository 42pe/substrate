import { ANY_NODE_ID, type FlowModel, type FlowNode } from './flow.js';
import { escXml, truncate } from './html.js';

/**
 * Render a board's flow model as a self-contained inline `<svg>`: stages as
 * boxes left-to-right by position, transitions as edges (backbone / guarded /
 * wildcard), with CSS `:hover` (styles live in the page `<style>`) and `<title>`
 * tooltips. Deterministic layout (positions derived from indices) so the same
 * board always produces byte-identical SVG.
 */

const BOX_W = 150;
const BOX_H = 46;
const GAP = 70;
const MARGIN = 24;
const ROW_Y = 90;
const ANY_Y = ROW_Y + 120;
const ARCH_Y = ROW_Y + 210;

function nodeX(i: number): number {
  return MARGIN + i * (BOX_W + GAP);
}

function box(n: FlowNode, x: number, y: number): string {
  const cls = ['node', n.archived ? 'archived' : '', n.gated ? 'gated' : '']
    .filter(Boolean)
    .join(' ');
  const tipParts = [n.description].filter(Boolean);
  if (n.suggestions.length > 0) tipParts.push(`suggests: ${n.suggestions.join('; ')}`);
  if (n.gated) tipParts.push('gated entry (see "any stage")');
  const title = tipParts.length > 0 ? `<title>${escXml(tipParts.join('\n'))}</title>` : '';
  const label = escXml(truncate(n.name, 20));
  const sub = n.archived ? '<tspan dx="4" fill="#9ca3af">(archived)</tspan>' : '';
  const marker =
    n.suggestions.length > 0 || n.gated
      ? `<text x="${x + BOX_W - 12}" y="${y + 16}" fill="#d97706">●</text>`
      : '';
  return `<g class="${cls}" id="node-${n.slug}">${title}<rect x="${x}" y="${y}" width="${BOX_W}" height="${BOX_H}" rx="8"/><text x="${x + BOX_W / 2}" y="${y + BOX_H / 2 + 4}" text-anchor="middle">${label}${sub}</text>${marker}</g>`;
}

function edgePath(
  d: string,
  cls: string,
  label: string,
  lx: number,
  ly: number,
  tooltip: string,
): string {
  const title = tooltip ? `<title>${escXml(tooltip)}</title>` : '';
  const text = label
    ? `<text x="${lx}" y="${ly}" text-anchor="middle">${escXml(truncate(label, 28))}</text>`
    : '';
  return `<g class="edge ${cls}">${title}<path d="${d}" marker-end="url(#arrow)"/>${text}</g>`;
}

export function renderModel(model: FlowModel): string {
  const index = new Map<string, number>();
  model.nodes.forEach((n, i) => index.set(n.id, i));

  const n = model.nodes.length;
  const width = Math.max(MARGIN * 2 + n * BOX_W + Math.max(0, n - 1) * GAP, 320);
  const height =
    (model.archivedNodes.length > 0
      ? ARCH_Y + BOX_H
      : model.hasAny
        ? ANY_Y + BOX_H
        : ROW_Y + BOX_H) + MARGIN;

  const parts: string[] = [];

  // edges first (under the boxes)
  for (const e of model.edges) {
    if (e.from === ANY_NODE_ID) {
      const j = index.get(e.to);
      if (j === undefined) continue;
      const x2 = nodeX(j) + BOX_W / 2;
      const d = `M ${MARGIN + BOX_W / 2} ${ANY_Y} C ${MARGIN + BOX_W / 2} ${ANY_Y - 40}, ${x2} ${ROW_Y + BOX_H + 40}, ${x2} ${ROW_Y + BOX_H}`;
      parts.push(
        edgePath(d, 'wildcard', e.label, (MARGIN + BOX_W / 2 + x2) / 2, ANY_Y - 10, e.tooltip),
      );
      continue;
    }
    const i = index.get(e.from);
    const j = index.get(e.to);
    if (i === undefined || j === undefined) continue;
    const x1 = nodeX(i) + BOX_W;
    const x2 = nodeX(j);
    const yMid = ROW_Y + BOX_H / 2;
    if (j === i + 1) {
      const d = `M ${x1} ${yMid} L ${x2} ${yMid}`;
      parts.push(edgePath(d, e.kind, e.label, (x1 + x2) / 2, yMid - 6, e.tooltip));
    } else {
      // non-adjacent → arc above the row
      const from = nodeX(i) + BOX_W / 2;
      const to = nodeX(j) + BOX_W / 2;
      const arc = 30 + Math.abs(j - i) * 14;
      const cy = ROW_Y - arc;
      const d = `M ${from} ${ROW_Y} Q ${(from + to) / 2} ${cy}, ${to} ${ROW_Y}`;
      parts.push(edgePath(d, e.kind, e.label, (from + to) / 2, cy + 4, e.tooltip));
    }
  }

  // nodes
  model.nodes.forEach((node, i) => parts.push(box(node, nodeX(i), ROW_Y)));
  if (model.hasAny) {
    parts.push(
      `<g class="node any" id="node-__any__"><rect x="${MARGIN}" y="${ANY_Y}" width="${BOX_W}" height="${BOX_H}" rx="8" stroke-dasharray="4 3"/><text x="${MARGIN + BOX_W / 2}" y="${ANY_Y + BOX_H / 2 + 4}" text-anchor="middle" fill="#6b7280">any stage</text></g>`,
    );
  }
  model.archivedNodes.forEach((node, i) => parts.push(box(node, nodeX(i), ARCH_Y)));

  return `<svg class="flow" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" role="img">
<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#9ca3af"/></marker></defs>
${parts.join('\n')}
</svg>`;
}
