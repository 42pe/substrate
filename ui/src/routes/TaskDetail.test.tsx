import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import * as api from '../lib/api.js';
import { TaskDetail } from './TaskDetail.js';

vi.mock('../lib/api.js', async (orig) => {
  const actual = await orig<typeof import('../lib/api.js')>();
  return {
    ...actual,
    getTask: vi.fn(),
    getComments: vi.fn(),
    getTaskHistory: vi.fn(),
    getTaskApproval: vi.fn(),
  };
});

const task = {
  id: 't1',
  board_id: 'b1',
  group_id: 'g1',
  parent_id: null,
  origin_task_id: null,
  title: 'My Task',
  description: 'desc',
  custom_data: {},
  version: 1,
  created_by_agent: 'tester',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  archived_at: null,
};

function renderAt(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/tasks/${id}`]}>
      <Routes>
        <Route path="/tasks/:id" element={<TaskDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(api.getTask).mockResolvedValue(task);
  vi.mocked(api.getTaskApproval).mockResolvedValue({ pending: false, awaiting_fields: [] });
  vi.mocked(api.getTaskHistory).mockResolvedValue({
    results: [],
    pagination: { next_cursor: null, has_more: false, page_size: 50 },
  });
});

describe('TaskDetail', () => {
  it('renders a comment body through <Markdown> (script is sanitized away, bold survives)', async () => {
    vi.mocked(api.getComments).mockResolvedValue({
      results: [
        {
          id: 'c1',
          task_id: 't1',
          parent_id: null,
          body: '**bold** <script>alert(1)</script>',
          custom_data: {},
          created_by_agent: 'tester',
          created_at: '2026-01-01T00:00:00.000Z',
          edited_at: null,
          archived_at: null,
        },
      ],
      pagination: { next_cursor: null, has_more: false, page_size: 50 },
    });

    const { container } = renderAt('t1');
    await screen.findByText('My Task');
    await userEvent.click(screen.getByRole('tab', { name: 'Comments' }));

    // Bold renders as a real element; the <script> is stripped, not present.
    expect(await screen.findByText('bold')).toBeTruthy();
    expect(container.querySelector('strong')?.textContent).toBe('bold');
    expect(container.querySelector('script')).toBeNull();
  });

  it('shows a not-found state for a 404 task', async () => {
    vi.mocked(api.getTask).mockRejectedValue(new api.ApiError(404, null));
    renderAt('ghost');
    expect(await screen.findByText('Not found')).toBeTruthy();
  });

  it('shows a "pending approval" pill when the task awaits a human gate', async () => {
    vi.mocked(api.getTaskApproval).mockResolvedValue({
      pending: true,
      gate: { policy_id: 'g', policy_name: 'Approval gate', to_group: 'done' },
      awaiting_fields: ['plan_approved'],
    });
    renderAt('t1');
    await screen.findByText('My Task');
    const pill = await screen.findByText('pending approval');
    expect(pill).toBeTruthy();
    expect(pill.getAttribute('title')).toContain('plan_approved');
  });
});
