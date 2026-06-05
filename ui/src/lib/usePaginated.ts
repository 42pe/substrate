import { useCallback, useEffect, useRef, useState } from 'react';
import type { Paginated } from './api.js';

/**
 * Cursor-pagination hook for the inspector lists (tasks, comments, events).
 * Resets and loads page 1 whenever `deps` change; `loadMore()` appends the
 * next page. `fetchPage(cursor?)` is captured in a ref so a fresh closure
 * each render does not retrigger the reset — only `deps` does.
 */
export interface PaginatedState<T> {
  items: T[];
  error: Error | null;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  loadMore: () => void;
}

export function usePaginated<T>(
  fetchPage: (cursor?: string) => Promise<Paginated<T>>,
  deps: unknown[],
): PaginatedState<T> {
  const [items, setItems] = useState<T[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const cursorRef = useRef<string | null>(null);
  const tokenRef = useRef(0);
  const fetchRef = useRef(fetchPage);

  // Keep the latest fetchPage closure in a ref (updated in an effect, never
  // during render) so a fresh closure each render does not retrigger the
  // reset effect — only `deps` does.
  useEffect(() => {
    fetchRef.current = fetchPage;
  });

  useEffect(() => {
    const token = ++tokenRef.current;
    setItems([]);
    setError(null);
    setLoading(true);
    setLoadingMore(false);
    setHasMore(false);
    cursorRef.current = null;
    fetchRef
      .current()
      .then((page) => {
        if (tokenRef.current !== token) return;
        setItems(page.results);
        cursorRef.current = page.pagination.next_cursor;
        setHasMore(page.pagination.has_more);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (tokenRef.current !== token) return;
        setError(e instanceof Error ? e : new Error(String(e)));
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore || cursorRef.current === null) return;
    const token = tokenRef.current;
    const cursor = cursorRef.current;
    setLoadingMore(true);
    fetchRef
      .current(cursor)
      .then((page) => {
        if (tokenRef.current !== token) return;
        setItems((prev) => [...prev, ...page.results]);
        cursorRef.current = page.pagination.next_cursor;
        setHasMore(page.pagination.has_more);
        setLoadingMore(false);
      })
      .catch((e: unknown) => {
        if (tokenRef.current !== token) return;
        setError(e instanceof Error ? e : new Error(String(e)));
        setLoadingMore(false);
      });
  }, [loadingMore, hasMore]);

  return { items, error, loading, loadingMore, hasMore, loadMore };
}
