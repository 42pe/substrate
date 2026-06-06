/**
 * Render policy condition trees as human-readable prose. Input is the raw,
 * unstructured `definition` data (`Record<string, unknown>` → arbitrary), so
 * everything degrades gracefully: a shape it can't make sense of becomes
 * `(unparseable condition)` rather than throwing — `explain` must never crash
 * on a malformed-but-loadable policy.
 *
 * Field references: a leaf `field` of `task.<name>` is shown as `<name>`. The
 * literal-vs-custom_data distinction is explained once in the page legend (see
 * render.ts); here we just strip the `task.` prefix for readability.
 */

/** Real task fields that resolve literally (never fall back to custom_data). */
export const LITERAL_TASK_FIELDS = [
  'id',
  'board_id',
  'group_id',
  'parent_id',
  'origin_task_id',
  'title',
  'description',
  'custom_data',
  'version',
  'created_by_agent',
  'created_at',
  'updated_at',
  'archived_at',
];

function fmt(v: unknown): string {
  return typeof v === 'string' ? v : JSON.stringify(v);
}

function fmtSet(values: unknown): string {
  return Array.isArray(values) ? `{${values.map(fmt).join(', ')}}` : '{}';
}

function fieldName(field: unknown): string {
  return typeof field === 'string' ? field.replace(/^task\./, '') : '(?)';
}

function describeLeaf(c: {
  field?: unknown;
  op?: unknown;
  value?: unknown;
  values?: unknown;
}): string {
  if (typeof c.field !== 'string' || typeof c.op !== 'string') return '(unparseable condition)';
  const f = fieldName(c.field);
  const v = fmt(c.value);
  const vs = fmtSet(c.values);
  switch (c.op) {
    case 'exists':
      return `${f} is set`;
    case 'not_exists':
      return `${f} is not set`;
    case 'is_empty':
      return `${f} is empty`;
    case 'not_empty':
      return `${f} is non-empty`;
    case 'eq':
      return `${f} = ${v}`;
    case 'neq':
      return `${f} ≠ ${v}`;
    case 'in':
      return `${f} in ${vs}`;
    case 'not_in':
      return `${f} not in ${vs}`;
    case 'gt':
      return `${f} > ${v}`;
    case 'gte':
      return `${f} ≥ ${v}`;
    case 'lt':
      return `${f} < ${v}`;
    case 'lte':
      return `${f} ≤ ${v}`;
    case 'contains':
      return `${f} contains ${v}`;
    case 'not_contains':
      return `${f} does not contain ${v}`;
    case 'starts_with':
      return `${f} starts with ${v}`;
    case 'ends_with':
      return `${f} ends with ${v}`;
    case 'matches_regex':
      return `${f} matches /${fmt(c.value)}/`;
    case 'matches_any_keyword':
      return `${f} matches any keyword ${vs}`;
    case 'has_any':
      return `${f} includes any of ${vs}`;
    case 'has_all':
      return `${f} includes all of ${vs}`;
    default:
      return '(unparseable condition)';
  }
}

function describeCondition(c: unknown): string {
  if (c === null || typeof c !== 'object') return '(unparseable condition)';
  const obj = c as Record<string, unknown>;
  if (Array.isArray(obj['all_of']))
    return `all of: (${obj['all_of'].map(describeCondition).join('; ')})`;
  if (Array.isArray(obj['any_of']))
    return `any of: (${obj['any_of'].map(describeCondition).join('; ')})`;
  if (Array.isArray(obj['none_of']))
    return `none of: (${obj['none_of'].map(describeCondition).join('; ')})`;
  return describeLeaf(obj);
}

/** Render a condition list (implicit `all_of`) as prose. Empty ⇒ "(always)". */
export function describeConditions(conds: unknown): string {
  if (!Array.isArray(conds) || conds.length === 0) return '(always)';
  return conds.map(describeCondition).join(' and ');
}
