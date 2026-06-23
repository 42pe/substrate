import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useMovedTasks } from './Kanban.js';
import type { BoardColumn, ColumnTask } from '../lib/api.js';

function task(id: string): ColumnTask {
  return {
    id,
    board_id: 'b',
    group_id: 'ignored',
    parent_id: null,
    origin_task_id: null,
    title: id,
    description: '',
    custom_data: {},
    version: 1,
    created_by_agent: 'x',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    archived_at: null,
    missing_required_fields: [],
  };
}

function cols(map: Record<string, string[]>): BoardColumn[] {
  return Object.entries(map).map(([group_id, ids], i) => ({
    group_id,
    group_name: group_id,
    position: i,
    color: null,
    total: ids.length,
    tasks: ids.map(task),
  }));
}

describe('useMovedTasks', () => {
  it('flags nothing on the first snapshot', async () => {
    const first = cols({ g1: ['t1', 't2'], g2: ['t3'] });
    const { result } = renderHook(({ c }) => useMovedTasks(c), { initialProps: { c: first } });
    await act(async () => {});
    expect([...result.current]).toEqual([]);
  });

  it('flags exactly the task that changed column', async () => {
    const first = cols({ g1: ['t1', 't2'], g2: ['t3'] });
    const { result, rerender } = renderHook(({ c }) => useMovedTasks(c), {
      initialProps: { c: first },
    });
    await act(async () => {});
    // t2 moves g1 -> g2; t1/t3 unchanged
    rerender({ c: cols({ g1: ['t1'], g2: ['t3', 't2'] }) });
    await act(async () => {});
    expect([...result.current].sort()).toEqual(['t2']);
  });

  it('flags a newly appeared task', async () => {
    const { result, rerender } = renderHook(({ c }) => useMovedTasks(c), {
      initialProps: { c: cols({ g1: ['t1'] }) },
    });
    await act(async () => {});
    rerender({ c: cols({ g1: ['t1', 't9'] }) });
    await act(async () => {});
    expect([...result.current]).toEqual(['t9']);
  });
});
