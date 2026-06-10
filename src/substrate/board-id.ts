import { basename } from 'node:path';

/**
 * A board id becomes a filename (`boards/<id>.json`). It must be a single safe
 * path component — anything else (`../../evil`, `a/b`, `a\b`, `..`, empty) could
 * escape `boards/`. This is the ONE definition of "safe board id"; `writer.ts`
 * (read/write paths) and `add` (the `--as` rename) both consume it so the rule
 * lives in exactly one place (Phase 8 / C2).
 *
 * Pure predicate, no throw — callers raise the error appropriate to their
 * context (writer's read-path `not_found`; add's rename-specific
 * `schema_violation`).
 */
export function isSafeBoardId(id: string): boolean {
  return (
    id.length > 0 &&
    id === basename(id) &&
    !id.includes('/') &&
    !id.includes('\\') &&
    !id.includes('..')
  );
}
