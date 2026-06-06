import { describe, it, expect } from 'vitest';
import { renderSubstrateHtml } from './render.js';
import { loadTemplateBoard } from '../cli/templates/index.js';
import type { Board, Config, Substrate } from '../core/types.js';

const config: Config = {
  project_id: '00000000-0000-4000-8000-000000000000',
  project_name: 'Proj',
  description: '',
  version: 1,
  schema_version: 2,
  created_at: '2026-01-01T00:00:00.000Z',
};

function substrate(boards: Board[]): Substrate {
  return { config, boards };
}

describe('renderSubstrateHtml', () => {
  it('renders the web-delivery board: self-contained, has an SVG, no scripts/external refs', () => {
    const html = renderSubstrateHtml(substrate([loadTemplateBoard('web-delivery')]));
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<svg');
    expect(html).toContain('Delivery');
    expect(html).toContain('spec_approved'); // a gate condition rendered
    expect(html).not.toContain('<script');
    expect(html).not.toMatch(/src="https?:/);
    expect(html).not.toMatch(/href="https?:[^"]*\.css/);
  });

  it('escapes a malicious group name and sanitizes the slug (no breakout)', () => {
    const evil: Board = {
      id: 'b',
      name: 'B',
      description: '',
      field_schema: { task: {}, comments: {} },
      groups: [
        {
          id: 'x" onload="alert(1)',
          name: '<script>alert(1)</script>',
          description: '"><img src=x onerror=y>',
          position: 0,
          color: null,
          version: 1,
          archived_at: null,
        },
      ],
      policies: [],
      version: 1,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      archived_at: null,
    };
    const html = renderSubstrateHtml(substrate([evil]));
    // No dangerous tag can FORM (escaping neutralizes < > "); inert escaped
    // text like "onerror=y" may remain but is harmless.
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('onload="alert(1)"'); // the id's quote never lands raw
    // The escaped form is present.
    expect(html).toContain('&lt;script&gt;');
    // The id="node-..." slug carries no quote that could break the attribute.
    const idMatch = html.match(/id="node-([^"]*)"/);
    expect(idMatch?.[1]).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('is deterministic (same substrate → byte-identical output)', () => {
    const b = loadTemplateBoard('web-delivery');
    expect(renderSubstrateHtml(substrate([b]))).toBe(
      renderSubstrateHtml(substrate([loadTemplateBoard('web-delivery')])),
    );
  });

  it('renders a "No boards yet" page for an empty substrate', () => {
    const html = renderSubstrateHtml(substrate([]));
    expect(html).toContain('No boards yet');
    expect(html.startsWith('<!doctype html>')).toBe(true);
  });
});
