/**
 * Escaping for the two output contexts of `substrate explain`. Author-controlled
 * strings (board/group/policy names + descriptions, field names, enum values,
 * agent names, on_failure_message, group-id labels) must NEVER reach the output
 * raw. There is no markdown rendering in the CLI output — escaped plain text only
 * (we deliberately do NOT pull marked/DOMPurify into the server/CLI path).
 */

/** Escape for HTML text and double-quoted attribute contexts. */
export function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escape for SVG `<text>` / `<title>` element content (XML text). */
export function escXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Sanitize a string to a safe `[A-Za-z0-9_-]` slug for use in SVG `id=`/`class=`
 * attributes. This is NOT escaping — it strips everything else, so a
 * quote/angle-bracket-bearing group id can't break out of an attribute.
 */
export function slugify(s: string): string {
  const base = s
    .replace(/[^A-Za-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return base.length > 0 ? base : 'x';
}

/** Truncate a label for diagram display; full text lives in tooltips/tables. */
export function truncate(s: string, max = 40): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

const STYLE = `
  :root { color-scheme: light; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    margin: 0; padding: 2rem; color: #1f2329; background: #fafbfc; line-height: 1.5; }
  h1 { font-size: 1.5rem; margin: 0 0 0.25rem; }
  h2 { font-size: 1.1rem; margin: 2rem 0 0.5rem; }
  h3 { font-size: 0.95rem; margin: 1.25rem 0 0.4rem; color: #4b5563; }
  .muted { color: #6b7280; }
  .board { border: 1px solid #e5e7eb; border-radius: 10px; background: #fff; padding: 1.25rem 1.5rem; margin: 1.5rem 0; }
  .diagram { overflow-x: auto; padding: 0.5rem 0; }
  table { border-collapse: collapse; width: 100%; font-size: 0.85rem; margin: 0.25rem 0 0.75rem; }
  th, td { text-align: left; padding: 0.3rem 0.6rem; border-bottom: 1px solid #f0f1f3; vertical-align: top; }
  th { color: #6b7280; font-weight: 600; text-transform: uppercase; font-size: 0.7rem; letter-spacing: 0.03em; }
  code, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.85em; }
  .badge { display: inline-block; border: 1px solid #d1d5db; border-radius: 5px; padding: 0 0.4rem; font-size: 0.72rem; color: #4b5563; }
  .badge.disabled { color: #9ca3af; }
  ul { margin: 0.25rem 0 0.75rem; padding-left: 1.1rem; }
  li { margin: 0.15rem 0; }
  /* SVG interactivity (CSS only) */
  svg .node rect { fill: #fff; stroke: #9ca3af; transition: fill 0.1s, stroke 0.1s; }
  svg .node:hover rect { fill: #eef2ff; stroke: #6366f1; }
  svg .node.archived rect { stroke-dasharray: 4 3; stroke: #d1d5db; fill: #f9fafb; }
  svg .node.gated rect { stroke: #d97706; }
  svg .edge path { stroke: #9ca3af; fill: none; }
  svg .edge.guard path { stroke: #d97706; }
  svg .edge.wildcard path { stroke: #d97706; stroke-dasharray: 4 3; }
  svg .edge:hover path { stroke: #4338ca; stroke-width: 2; }
  svg text { fill: #1f2329; font-size: 12px; }
  svg .edge text { fill: #6b7280; font-size: 10px; }
`;

/** Wrap a body in a self-contained HTML page. No external refs, no scripts. */
export function pageShell(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
${bodyHtml}
</body>
</html>
`;
}
