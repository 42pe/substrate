import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import * as api from '../lib/api.js';
import type { BoardColumnsResult, BoardSubstrate, Paginated } from '../lib/api.js';
import type { Task } from '@core/types';
import { BoardDetail } from './BoardDetail.js';

vi.mock('../lib/api.js', async (orig) => {
  const actual = await orig<typeof import('../lib/api.js')>();
  return { ...actual, getBoard: vi.fn(), getBoardColumns: vi.fn(), getTasks: vi.fn() };
});

const substrate: BoardSubstrate = {
  board: {
    id: 'b1',
    name: 'Roadmap',
    description: 'A board',
    version: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    archived_at: null,
  },
  groups: [
    { id: 'g1', name: 'Todo', description: '', position: 0, color: null, version: 1, archived_at: null },
    { id: 'g2', name: 'Doing', description: '', position: 1, color: null, version: 1, archived_at: null },
  ],
  field_schema: { task: {}, comments: {} },
  policies: [],
};

function task(id: string, groupId: string): Task {
  return {
    id,
    board_id: 'b1',
    group_id: groupId,
    parent_id: null,
    origin_task_id: null,
    title: `Task ${id}`,
    description: '',
    custom_data: {},
    version: 1,
    created_by_agent: 'x',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    archived_at: null,
  };
}

const columns: BoardColumnsResult = {
  board_id: 'b1',
  columns: [
    { group_id: 'g1', group_name: 'Todo', position: 0, color: null, total: 5, tasks: [task('t1', 'g1'), task('t2', 'g1')] },
    { group_id: 'g2', group_name: 'Doing', position: 1, color: null, total: 1, tasks: [task('t3', 'g2')] },
  ],
};

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/boards/:id" element={<BoardDetail />} />
        <Route path="/tasks/:id" element={<div>task page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const emptyPage: Paginated<Task> = {
  results: [],
  pagination: { next_cursor: null, has_more: false, page_size: 25 },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getBoard).mockResolvedValue(substrate);
  vi.mocked(api.getBoardColumns).mockResolvedValue(columns);
  vi.mocked(api.getTasks).mockResolvedValue(emptyPage);
});

describe('BoardDetail kanban', () => {
  it('renders columns in position order with counts (kanban is the default view)', async () => {
    renderAt('/boards/b1');
    const todo = await screen.findByText('Todo');
    expect(todo).toBeTruthy();
    expect(screen.getByText('Doing')).toBeTruthy();
    // cards present
    expect(screen.getByText('Task t1')).toBeTruthy();
    expect(screen.getByText('Task t3')).toBeTruthy();
    // count badge shows the true total
    expect(screen.getByText('5')).toBeTruthy();
  });

  it('shows "+N more — open List" when total exceeds the preview, linking to ?view=list&group=', async () => {
    renderAt('/boards/b1');
    const more = await screen.findByText('+3 more — open List'); // total 5 - 2 shown
    expect((more as HTMLAnchorElement).getAttribute('href')).toContain('view=list');
    expect((more as HTMLAnchorElement).getAttribute('href')).toContain('group=g1');
  });

  it('?view=list renders the task table and seeds the group filter from ?group', async () => {
    renderAt('/boards/b1?view=list&group=g2');
    await waitFor(() => expect(api.getTasks).toHaveBeenCalled());
    // the table fetch carried in_groups=g2 (the deep-link seed)
    expect(api.getTasks).toHaveBeenCalledWith(expect.objectContaining({ in_groups: 'g2' }));
    // and kanban columns are NOT fetched in list view
    expect(api.getBoardColumns).not.toHaveBeenCalled();
  });

  it('demotes board details into a collapsed disclosure (description not shown until expanded)', async () => {
    renderAt('/boards/b1');
    await screen.findByText('Todo');
    const summary = screen.getByText(/Board details/);
    expect(summary).toBeTruthy();
    const details = summary.closest('details');
    expect(details?.open).toBe(false); // collapsed by default
  });

  it('renders a live indicator in kanban view', async () => {
    renderAt('/boards/b1');
    await screen.findByText('Todo');
    expect(screen.getByText(/live/)).toBeTruthy();
  });
});
