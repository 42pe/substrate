import { useEffect, useState } from 'react';
import { cn } from '../lib/cn.js';
import { timeAgo } from '../lib/format.js';

/**
 * The polling status affordance (Phase 9): a pulsing dot + "live · updated Ns
 * ago", switching to "reconnecting…" on a failed background poll and "paused"
 * when the tab is hidden. Read-only / informational. Re-renders once a second
 * so the relative time stays fresh.
 */
export function LiveIndicator({
  paused,
  reconnecting,
  lastUpdated,
}: {
  paused: boolean;
  reconnecting: boolean;
  lastUpdated: number | null;
}) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const state = paused ? 'paused' : reconnecting ? 'reconnecting' : 'live';
  const label =
    state === 'paused'
      ? 'paused'
      : state === 'reconnecting'
        ? 'reconnecting…'
        : lastUpdated === null
          ? 'live'
          : `live · updated ${timeAgo(lastUpdated)} ago`;
  // Differentiate by SHAPE as well as color so status isn't color-only (WCAG
  // 1.4.1): live = solid pulse, reconnecting = amber pulse, paused = hollow ring.
  const dot =
    state === 'paused'
      ? 'border-2 border-muted-foreground'
      : cn(state === 'reconnecting' ? 'bg-warning-foreground' : 'bg-success', 'animate-pulse');

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span aria-hidden className={cn('h-2 w-2 rounded-full', dot)} />
      <span aria-hidden>{label}</span>
      {/*
       * Announce only state TRANSITIONS to screen readers — the visible label
       * re-renders every second (relative time) and is aria-hidden, so this
       * sr-only region (whose text changes only when `state` changes) won't
       * spam the per-second tick.
       */}
      <span className="sr-only" aria-live="polite">
        {state === 'live' ? 'Live' : state === 'reconnecting' ? 'Reconnecting' : 'Updates paused'}
      </span>
    </span>
  );
}
