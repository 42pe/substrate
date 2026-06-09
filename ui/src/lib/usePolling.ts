import { useEffect, useRef, useState } from 'react';

/**
 * Visibility-aware polling hook (Phase 9). Re-fetches `fn` on an interval so
 * the read-only inspector reflects agents' MCP task-moves live, WITHOUT the
 * loading flash on every tick that `useResource` would cause (its reset-on-deps
 * is load-bearing for navigation, so we don't extend it — we model the
 * `fetchRef`/`tokenRef` discipline of `usePaginated` instead).
 *
 * Contract:
 *   - First load (and any `deps` change) shows `loading: true` until data lands.
 *   - Interval ticks refresh `data` IN PLACE — never flip `loading` back to true,
 *     never clear `data` (no flicker).
 *   - When the tab is hidden, polling PAUSES (`paused: true`); on becoming
 *     visible again it refetches immediately and resumes.
 *   - A failed background poll (after first load) keeps the last good `data` and
 *     raises `reconnecting`; it does NOT surface a hard error. A failed FIRST
 *     load sets `error` (as `useResource` would).
 *   - Type-agnostic: callers that need a moved-card diff compute it themselves
 *     from successive `data` values.
 */

export const POLL_INTERVAL_MS = 4000;

export interface PollingState<T> {
  data: T | null;
  /** Hard error — only set when the FIRST load fails (no data to show). */
  error: Error | null;
  /** True only during the initial load / a `deps`-change reload. */
  loading: boolean;
  /** Tab hidden → polling suspended. */
  paused: boolean;
  /** Last background poll failed but prior `data` is still shown. */
  reconnecting: boolean;
  /** `Date.now()` of the last successful load, or null. */
  lastUpdated: number | null;
}

export function usePolling<T>(
  fn: () => Promise<T>,
  deps: unknown[],
  opts: { intervalMs?: number } = {},
): PollingState<T> {
  const intervalMs = opts.intervalMs ?? POLL_INTERVAL_MS;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  const fnRef = useRef(fn);
  const tokenRef = useRef(0);
  const hasDataRef = useRef(false);

  // Capture the latest closure in a ref (updated in an effect, never during
  // render) so a fresh `fn` each render doesn't retrigger the reset effect.
  useEffect(() => {
    fnRef.current = fn;
  });

  useEffect(() => {
    const token = ++tokenRef.current;
    let cancelled = false; // set on unmount (no later effect bumps the token then)
    hasDataRef.current = false;
    setData(null);
    setError(null);
    setLoading(true);
    setReconnecting(false);
    setLastUpdated(null);

    const run = (): void => {
      fnRef
        .current()
        .then((d) => {
          if (cancelled || tokenRef.current !== token) return; // stale / unmounted
          hasDataRef.current = true;
          setData(d);
          setError(null);
          setLoading(false);
          setReconnecting(false);
          setLastUpdated(Date.now());
        })
        .catch((e: unknown) => {
          if (cancelled || tokenRef.current !== token) return;
          if (hasDataRef.current) {
            setReconnecting(true); // keep last good data
          } else {
            setError(e instanceof Error ? e : new Error(String(e)));
            setLoading(false);
          }
        });
    };

    let intervalId: ReturnType<typeof setInterval> | undefined;
    const startInterval = (): void => {
      if (intervalId === undefined) intervalId = setInterval(run, intervalMs);
    };
    const stopInterval = (): void => {
      if (intervalId !== undefined) {
        clearInterval(intervalId);
        intervalId = undefined;
      }
    };

    const onVisibility = (): void => {
      if (document.hidden) {
        setPaused(true);
        stopInterval();
      } else {
        setPaused(false);
        run(); // immediate catch-up
        startInterval();
      }
    };

    run(); // first load
    if (document.hidden) {
      setPaused(true);
    } else {
      startInterval();
    }
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true; // invalidate any in-flight resolution
      stopInterval();
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading, paused, reconnecting, lastUpdated };
}
