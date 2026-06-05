import { renderMarkdown } from '../lib/markdown.js';

/**
 * The ONE component allowed to inject HTML. Author-supplied markdown is
 * rendered exclusively through `renderMarkdown` (marked → DOMPurify). The ui
 * ESLint config bans `dangerouslySetInnerHTML` everywhere else, so this is the
 * single sanitized render path (R-P5-3).
 */
export function Markdown({ source, className }: { source: string; className?: string }) {
  return (
    // The no-restricted-syntax rule stays ON for this file, so a SECOND,
    // accidental dangerouslySetInnerHTML here would still be flagged. This one
    // line is the single sanitized render path: renderMarkdown = marked → DOMPurify.
    // eslint-disable-next-line no-restricted-syntax
    <div className={className} dangerouslySetInnerHTML={{ __html: renderMarkdown(source) }} />
  );
}
