/** Small formatting helpers shared across the inspector pages. */

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso ?? '—';
  // Medium date + short time reads like a UI, not a debug dump
  // ("Jun 28, 2026, 7:00 PM" rather than "6/28/2026, 7:00:00 PM").
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** Compact "time since" for the live indicator + kanban cards, e.g. `3s`,
 *  `4m`, `2h`, `5d`. Takes an ISO string or an epoch-ms number. */
export function timeAgo(input: string | number | null | undefined): string {
  if (input === null || input === undefined) return '—';
  const then = typeof input === 'number' ? input : new Date(input).getTime();
  if (Number.isNaN(then)) return typeof input === 'string' ? input : '—';
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** Render an arbitrary custom_data / changes value compactly for display. */
export function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}
