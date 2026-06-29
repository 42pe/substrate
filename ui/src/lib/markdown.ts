import { marked } from 'marked';
import DOMPurify from 'dompurify';

/**
 * The SINGLE markdown → safe-HTML path for the whole UI (security-critical,
 * R-P5-3). Every author-supplied string (task/board/project descriptions,
 * comment bodies, policy messages) flows through here before it can become DOM.
 *
 * Design (locked): DOMPurify is the single, sufficient sanitization gate.
 * `marked` runs near defaults (it passes inline HTML through — that is fine
 * *because* DOMPurify then strips anything dangerous: `<script>`, event-handler
 * attributes (`onerror=`…), and `javascript:`/`data:` URLs). `breaks: true` is
 * enabled so a single `\n` becomes `<br>` (agents author single-newline content;
 * without this it renders as a run-on block). This is NOT a raw-HTML-emitting
 * extension — `<br>` still passes through DOMPurify — so the single-gate
 * invariant holds. Do NOT "simplify" the DOMPurify call away, and do NOT enable
 * a marked extension that emits HTML the sanitizer wouldn't see.
 *
 * `<Markdown>` (components/Markdown.tsx) is the ONLY place `dangerouslySetInnerHTML`
 * is allowed — enforced by the ui ESLint config.
 */
export function renderMarkdown(src: string): string {
  const rawHtml = marked.parse(src, { async: false, breaks: true });
  return DOMPurify.sanitize(rawHtml, { USE_PROFILES: { html: true } });
}
