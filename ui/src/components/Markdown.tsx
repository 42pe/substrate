import { renderMarkdown } from '../lib/markdown.js';

/**
 * The ONE component allowed to inject HTML. Author-supplied markdown is
 * rendered exclusively through `renderMarkdown` (marked → DOMPurify). The ui
 * ESLint config bans `dangerouslySetInnerHTML` everywhere else, so this is the
 * single sanitized render path (R-P5-3).
 */
export function Markdown({ source, className }: { source: string; className?: string }) {
  // dangerouslySetInnerHTML is allowed ONLY here (ui ESLint enforces it
  // elsewhere). The HTML is sanitized by renderMarkdown (marked → DOMPurify).
  return <div className={className} dangerouslySetInnerHTML={{ __html: renderMarkdown(source) }} />;
}
