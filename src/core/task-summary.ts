import type { Task, TaskSummary } from './types.js';

/**
 * Project a full `Task` to a lean `TaskSummary` for `list_tasks` (default view).
 *
 * Two fields dominate a list response (a real 35-task board was 69KB: 47%
 * `description`, 33% `custom_data`). This drops both heavy parts while keeping
 * everything an agent needs to triage and select — then `get_task` (or
 * `list_tasks view:'full'`) reads the rest.
 *
 * `description` → a bounded, grapheme-safe excerpt (+ a `truncated` flag).
 * `custom_data` → only small scalar values; bulky values are dropped and their
 * keys reported in `custom_data_omitted` so the agent knows detail exists.
 */

/** Excerpt length cap, in graphemes (not UTF-16 code units — see `excerpt`). */
export const DESCRIPTION_EXCERPT_MAX = 200;
/** Longest string custom value kept verbatim in the summary. */
export const CUSTOM_VALUE_STRING_MAX = 120;

// Grapheme segmenter: truncating by code unit would split a surrogate pair
// (e.g. an emoji like 🔴 → a lone `\uD83D` → `�`). Segmenting by grapheme keeps
// whole characters. Constructed once (cheap to reuse, locale-irrelevant here).
const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });

/**
 * First `max` graphemes of `input`, backed off to the last word boundary when
 * one falls reasonably late, with `…` appended only when truncated. Length is
 * measured in graphemes so `truncated` is accurate for multibyte text.
 */
export function excerpt(
  input: string,
  max: number = DESCRIPTION_EXCERPT_MAX,
): { text: string; truncated: boolean } {
  if (!input) return { text: '', truncated: false };

  const segs = Array.from(graphemes.segment(input), (s) => s.segment);
  if (segs.length <= max) return { text: input, truncated: false };

  let head = segs.slice(0, max).join('');
  // Prefer a word boundary, but only if it doesn't chop off too much.
  const lastSpace = head.lastIndexOf(' ');
  if (lastSpace >= Math.floor(max * 0.6)) head = head.slice(0, lastSpace);
  return { text: `${head.trimEnd()}…`, truncated: true };
}

/** Trim `custom_data` to small scalar values; report dropped keys. */
function trimCustomData(custom_data: Record<string, unknown>): {
  kept: Record<string, unknown>;
  omitted: string[];
} {
  const kept: Record<string, unknown> = {};
  const omitted: string[] = [];
  for (const [key, value] of Object.entries(custom_data)) {
    if (
      value === null ||
      typeof value === 'boolean' ||
      typeof value === 'number' ||
      (typeof value === 'string' && value.length <= CUSTOM_VALUE_STRING_MAX)
    ) {
      kept[key] = value;
    } else {
      // long string, array, object, or undefined → detail-only, behind get_task
      omitted.push(key);
    }
  }
  return { kept, omitted };
}

export function toTaskSummary(task: Task): TaskSummary {
  const ex = excerpt(task.description);
  const { kept, omitted } = trimCustomData(task.custom_data);
  return {
    id: task.id,
    board_id: task.board_id,
    group_id: task.group_id,
    parent_id: task.parent_id,
    origin_task_id: task.origin_task_id,
    title: task.title,
    description_excerpt: ex.text,
    description_truncated: ex.truncated,
    custom_data: kept,
    custom_data_omitted: omitted,
    version: task.version,
    created_by_agent: task.created_by_agent,
    created_at: task.created_at,
    updated_at: task.updated_at,
    archived_at: task.archived_at,
  };
}
