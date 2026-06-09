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

  let label: string;
  let dot: string;
  if (paused) {
    label = 'paused';
    dot = 'bg-neutral-300';
  } else if (reconnecting) {
    label = 'reconnecting…';
    dot = 'bg-amber-400';
  } else {
    label = lastUpdated === null ? 'live' : `live · updated ${timeAgo(lastUpdated)} ago`;
    dot = 'bg-emerald-400';
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-neutral-500" aria-live="polite">
      <span className={cn('h-2 w-2 rounded-full', dot, !paused && !reconnecting && 'animate-pulse')} />
      {label}
    </span>
  );
}
