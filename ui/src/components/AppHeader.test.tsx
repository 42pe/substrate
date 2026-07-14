import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Link } from 'react-router-dom';
import type { Task } from '@core/types';
import * as api from '../lib/api.js';
import type { BoardSubstrate, ProjectRecord } from '../lib/api.js';
import { AppHeader } from './AppHeader.js';

vi.mock('../lib/api.js', async (orig) => {
  const actual = await orig<typeof import('../lib/api.js')>();
  return { ...actual, getProject: vi.fn(), getBoard: vi.fn(), getTask: vi.fn() };
});

const project: ProjectRecord = {
  project_id: 'p1',
  project_name: 'substrate',
  description: '',
  version: 1,
  schema_version: 2,
  created_at: '2026-01-01T00:00:00.000Z',
};

function boardSubstrate(id: string, name: string): BoardSubstrate {
  return {
    board: {
      id,
      name,
      description: '',
      version: 1,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      archived_at: null,
    },
    groups: [],
    field_schema: { task: {}, comments: {} },
    policies: [],
  };
}

function task(id: string, boardId: string): Task {
  return {
    id,
    board_id: boardId,
    group_id: 'g1',
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

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppHeader />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getProject).mockResolvedValue(project);
  // Echo the requested id (as the real endpoint does), so a task-route lookup
  // resolves to /boards/<board_id> rather than a fixed id. Distinct ids get
  // distinct names so a board→board switch can prove the name actually changes.
  vi.mocked(api.getBoard).mockImplementation((id: string) =>
    Promise.resolve(boardSubstrate(id, id === 'b2' ? 'Delivery' : 'Roadmap')),
  );
  vi.mocked(api.getTask).mockResolvedValue(task('t1', 'main'));
});

describe('AppHeader', () => {
  it.each(['/', '/boards', '/activity'])(
    'shows the project name (linking to Overview) and no board segment on %s',
    async (path) => {
      renderAt(path);
      const projectLink = await screen.findByRole('link', { name: 'substrate' });
      expect(projectLink.getAttribute('href')).toBe('/');
      // No board is resolved on non-board/task routes.
      expect(api.getBoard).not.toHaveBeenCalled();
      expect(api.getTask).not.toHaveBeenCalled();
      expect(screen.queryByRole('link', { name: 'Roadmap' })).toBeNull();
    },
  );

  it('shows the active board name (linking to the board) on a board route', async () => {
    renderAt('/boards/b1');
    const board = await screen.findByRole('link', { name: 'Roadmap' });
    expect(board.getAttribute('href')).toBe('/boards/b1');
    expect(api.getBoard).toHaveBeenCalledWith('b1');
    // Project segment is always present too.
    expect(screen.getByRole('link', { name: 'substrate' })).toBeTruthy();
  });

  it('resolves the board name (not the raw id) from the task on a task route', async () => {
    renderAt('/tasks/t1');
    const board = await screen.findByRole('link', { name: 'Roadmap' });
    expect(board.getAttribute('href')).toBe('/boards/main');
    expect(api.getTask).toHaveBeenCalledWith('t1');
    expect(api.getBoard).toHaveBeenCalledWith('main');
    // The bare board id is never surfaced as text.
    expect(screen.queryByText('main')).toBeNull();
  });

  it('updates the board segment on client-side navigation with no stale name', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/boards/b1']}>
        <AppHeader />
        <Link to="/">go home</Link>
      </MemoryRouter>,
    );
    // Board segment present on the board route…
    expect(await screen.findByRole('link', { name: 'Roadmap' })).toBeTruthy();
    // …and clears when navigating to a route with no active board.
    await user.click(screen.getByRole('link', { name: 'go home' }));
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Roadmap' })).toBeNull());
    // Project segment stays.
    expect(screen.getByRole('link', { name: 'substrate' })).toBeTruthy();
  });

  it('refreshes the board segment to the new name when navigating board → board', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/boards/b1']}>
        <AppHeader />
        <Link to="/boards/b2">go b2</Link>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('link', { name: 'Roadmap' })).toBeTruthy();
    await user.click(screen.getByRole('link', { name: 'go b2' }));
    // The segment updates to the new board's name and link — no stale 'Roadmap'.
    const next = await screen.findByRole('link', { name: 'Delivery' });
    expect(next.getAttribute('href')).toBe('/boards/b2');
    expect(screen.queryByRole('link', { name: 'Roadmap' })).toBeNull();
  });

  it('degrades gracefully to no board segment when the board fails to resolve', async () => {
    vi.mocked(api.getBoard).mockRejectedValue(new Error('boom'));
    renderAt('/boards/b1');
    // Project still renders; the board segment simply never appears (no throw).
    expect(await screen.findByRole('link', { name: 'substrate' })).toBeTruthy();
    await waitFor(() => expect(api.getBoard).toHaveBeenCalled());
    expect(screen.queryByRole('link', { name: 'Roadmap' })).toBeNull();
  });
});
