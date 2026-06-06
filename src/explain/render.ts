import type { Board, FieldSchemaEntry, Policy, Substrate } from '../core/types.js';
import { parseGuardDefinition } from '../policy/transition-guard.js';
import { parseResponsibilityDefinition } from '../policy/agent-responsibility.js';
import { describeConditions } from './conditions.js';
import { buildFlowModel, type FlowModel } from './flow.js';
import { renderModel } from './svg.js';
import { escHtml, pageShell } from './html.js';

/** Render the whole substrate as one self-contained HTML page. */
export function renderSubstrateHtml(substrate: Substrate): string {
  const { config, boards } = substrate;
  const title = `Substrate — ${config.project_name}`;
  const parts: string[] = [];
  parts.push(`<h1>${escHtml(config.project_name)}</h1>`);
  if (config.description) parts.push(`<p class="muted">${escHtml(config.description)}</p>`);

  if (boards.length === 0) {
    parts.push(
      `<p class="muted">No boards yet. Add one under <code>.substrate/boards/</code>.</p>`,
    );
    return pageShell(title, parts.join('\n'));
  }

  parts.push(LEGEND);
  for (const board of [...boards].sort(
    (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
  )) {
    parts.push(renderBoard(board));
  }
  return pageShell(title, parts.join('\n'));
}

const LEGEND = `<p class="muted" style="font-size:0.8rem">
Diagram: stages left→right; <span style="color:#d97706">amber</span> edges are policy gates (blocked unless their condition holds); a dashed <em>any stage → X</em> edge is a definition-of-done gate; a ● marks a stage with attached suggestions. Hover any box or edge for detail.
Condition fields: <code>task.&lt;field&gt;</code> reads the literal task field if it exists, else <code>custom_data.&lt;field&gt;</code>; built-in fields (<code>group_id</code>, <code>title</code>, …) always resolve literally.
</p>`;

function renderBoard(board: Board): string {
  const model = buildFlowModel(board);
  const out: string[] = [`<div class="board">`];
  out.push(`<h2>${escHtml(board.name)}</h2>`);
  out.push(`<p class="mono muted">${escHtml(board.id)}</p>`);
  if (board.description) out.push(`<p>${escHtml(board.description)}</p>`);
  out.push(`<div class="diagram">${renderModel(model)}</div>`);
  out.push(conditionalSuggestions(model));
  out.push(fieldTable('Task fields', board.field_schema.task));
  out.push(fieldTable('Comment fields', board.field_schema.comments));
  out.push(policyList(board.policies));
  out.push(`</div>`);
  return out.join('\n');
}

/**
 * Suggestions whose `when` isn't a single-stage condition (so they aren't pinned
 * to one diagram node) — listed once per board for the at-a-glance view. The
 * full detail is still in the policy list below.
 */
function conditionalSuggestions(model: FlowModel): string {
  if (model.conditionalSuggestions.length === 0) return '';
  const items = model.conditionalSuggestions
    .map(
      (s) =>
        `<li><strong>${escHtml(s.policyName)}</strong> — when ${escHtml(s.when)}: ${escHtml(s.message)}</li>`,
    )
    .join('');
  return `<h3>Conditional suggestions</h3><ul>${items}</ul>`;
}

function fieldTable(label: string, fields: Record<string, FieldSchemaEntry>): string {
  const entries = Object.entries(fields);
  if (entries.length === 0) return `<h3>${escHtml(label)}</h3><p class="muted">None.</p>`;
  const rows = entries
    .map(([name, def]) => {
      const extra = def.values
        ? def.values.map(escHtml).join(', ')
        : def.format
          ? escHtml(def.format)
          : '';
      return `<tr><td class="mono">${escHtml(name)}</td><td>${escHtml(def.type)}</td><td>${def.required ? 'yes' : ''}</td><td>${extra}</td></tr>`;
    })
    .join('');
  return `<h3>${escHtml(label)}</h3><table><thead><tr><th>Field</th><th>Type</th><th>Required</th><th>Values / format</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function policyList(policies: Policy[]): string {
  if (policies.length === 0) return `<h3>Policies</h3><p class="muted">None.</p>`;
  const sorted = [...policies].sort(
    (a, b) =>
      a.priority - b.priority ||
      a.created_at.localeCompare(b.created_at) ||
      a.id.localeCompare(b.id),
  );
  const rows = sorted
    .map((p) => {
      const state: string[] = [];
      if (!p.enabled) state.push('<span class="badge disabled">disabled</span>');
      if (p.archived_at !== null) state.push('<span class="badge disabled">archived</span>');
      const detail = p.type === 'transition_guard' ? guardDetail(p) : responsibilityDetail(p);
      return `<tr><td>${escHtml(p.name)} ${state.join(' ')}</td><td><span class="badge">${escHtml(p.type)}</span></td><td>${detail}</td></tr>`;
    })
    .join('');
  return `<h3>Policies (${policies.length})</h3><table><thead><tr><th>Policy</th><th>Type</th><th>Rule</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function guardDetail(p: Policy): string {
  const def = parseGuardDefinition(p.definition);
  if (!def) return `<span class="muted">(unparseable guard)</span>`;
  const transition = `${escHtml(def.fromGroup)} → ${escHtml(def.toGroup)}`;
  const cond = escHtml(describeConditions(def.require));
  const block = def.onFailureMessage
    ? `<br><span class="muted">blocks: ${escHtml(def.onFailureMessage)}</span>`
    : '';
  return `<code>${transition}</code> requires ${cond}${block}`;
}

function responsibilityDetail(p: Policy): string {
  const def = parseResponsibilityDefinition(p.definition);
  if (!def) return `<span class="muted">(unusable — no message)</span>`;
  const when = escHtml(describeConditions(def.when));
  return `when ${when}<br><span class="muted">${escHtml(def.message)}</span>`;
}
