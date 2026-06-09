import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePolling } from './usePolling.js';

const INTERVAL = 1000;

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function tick(ms: number = INTERVAL): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function setHidden(v: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => v });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

describe('usePolling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setHidden(false);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows loading on first load, then data', async () => {
    const fn = vi.fn().mockResolvedValue('A');
    const { result } = renderHook(() => usePolling(fn, [1], { intervalMs: INTERVAL }));
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBe(null);
    await flush();
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBe('A');
    expect(result.current.lastUpdated).not.toBe(null);
  });

  it('refreshes in place on a tick WITHOUT flipping loading or clearing data', async () => {
    const fn = vi.fn().mockResolvedValueOnce('A').mockResolvedValue('B');
    const { result } = renderHook(() => usePolling(fn, [1], { intervalMs: INTERVAL }));
    await flush();
    expect(result.current.data).toBe('A');
    await tick();
    expect(result.current.data).toBe('B');
    expect(result.current.loading).toBe(false); // never flipped back
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('pauses while hidden and refetches on becoming visible', async () => {
    const fn = vi.fn().mockResolvedValue('A');
    const { result } = renderHook(() => usePolling(fn, [1], { intervalMs: INTERVAL }));
    await flush();
    expect(fn).toHaveBeenCalledTimes(1);

    setHidden(true);
    expect(result.current.paused).toBe(true);
    await tick(INTERVAL * 3); // no polling while hidden
    expect(fn).toHaveBeenCalledTimes(1);

    setHidden(false);
    await flush(); // immediate catch-up refetch
    expect(result.current.paused).toBe(false);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('re-enters loading when deps change', async () => {
    const fn = vi.fn().mockResolvedValue('A');
    const { result, rerender } = renderHook(
      ({ d }: { d: number }) => usePolling(fn, [d], { intervalMs: INTERVAL }),
      { initialProps: { d: 1 } },
    );
    await flush();
    expect(result.current.loading).toBe(false);
    rerender({ d: 2 });
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBe(null);
    await flush();
    expect(result.current.data).toBe('A');
  });

  it('keeps last good data and sets reconnecting on a failed background poll', async () => {
    const fn = vi.fn().mockResolvedValueOnce('A').mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => usePolling(fn, [1], { intervalMs: INTERVAL }));
    await flush();
    expect(result.current.data).toBe('A');
    await tick();
    expect(result.current.data).toBe('A'); // preserved
    expect(result.current.reconnecting).toBe(true);
    expect(result.current.error).toBe(null); // not a hard error
  });

  it('sets error when the FIRST load fails', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('nope'));
    const { result } = renderHook(() => usePolling(fn, [1], { intervalMs: INTERVAL }));
    await flush();
    expect(result.current.error?.message).toBe('nope');
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBe(null);
  });
});
