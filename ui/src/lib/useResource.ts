import { useEffect, useState } from 'react';

/**
 * Minimal data-fetching hook (no TanStack Query — lighter stack). Runs `fn`
 * when `deps` change, tracks `{ data, error, loading }`, and ignores a
 * resolution after unmount / a newer request.
 */
export interface ResourceState<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
}

export function useResource<T>(fn: () => Promise<T>, deps: unknown[]): ResourceState<T> {
  const [state, setState] = useState<ResourceState<T>>({ data: null, error: null, loading: true });

  useEffect(() => {
    let active = true;
    setState({ data: null, error: null, loading: true });
    fn()
      .then((data) => {
        if (active) setState({ data, error: null, loading: false });
      })
      .catch((e: unknown) => {
        if (active) {
          setState({
            data: null,
            error: e instanceof Error ? e : new Error(String(e)),
            loading: false,
          });
        }
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
