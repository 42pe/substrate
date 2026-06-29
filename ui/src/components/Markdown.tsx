import { renderMarkdown } from '../lib/markdown.js';
import { cn } from '../lib/cn.js';

/**
 * The ONE component allowed to inject HTML. Author-supplied markdown is
 * rendered exclusively through `renderMarkdown` (marked → DOMPurify). The ui
 * ESLint config bans `dangerouslySetInnerHTML` everywhere else, so this is the
 * single sanitized render path (R-P5-3).
 */
export function Markdown({ source, className }: { source: string; className?: string }) {
  // Single sanitized render path: renderMarkdown = marked → DOMPurify. The
  // no-restricted-syntax rule stays ON for this file, so any SECOND, accidental
  // dangerouslySetInnerHTML would still be flagged. Kept on one line so the
  // disable directive sits directly above the attribute (printWidth 100).
  const html = renderMarkdown(source);
  return (
    // eslint-disable-next-line no-restricted-syntax
    <div className={cn('markdown', className)} dangerouslySetInnerHTML={{ __html: html }} />
  );
}
