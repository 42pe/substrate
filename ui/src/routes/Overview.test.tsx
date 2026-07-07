import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import * as api from '../lib/api.js';
import type { BoardColumnsResult, BoardSummary, ColumnTask, Paginated } from '../lib/api.js';
import { Overview } from './Overview.js';

vi.mock('../lib/api.js', async (orig) => {
  const actual = await orig<typeof import('../lib/api.js')>();
  return { ...actual, getProject: vi.fn(), getBoards: vi.fn(), getBoardColumns: vi.fn() };
});

const project = {
  project_id: 'p1',
  project_name: 'Demo',
  description: 'A **demo** project',
  version: 1,
  schema_version: 2,
  created_at: '2026-01-01T00:00:00.000Z',
};

function summary(id: string, name: string): BoardSummary {
  return { id, name, description: '', archived_at: null, version: 1 };
}

function boardsPage(results: BoardSummary[]): Paginated<BoardSummary> {
  return { results, pagination: { next_cursor: null, has_more: false, page_size: 50 } };
}

function task(id: string): ColumnTask {
  return {
    id,
    board_id: 'x',
    group_id: 'g',
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
    missing_required_fields: [],
    pending_approval: false,
    awaiting_fields: [],
  };
}

function colsFor(boardId: string): BoardColumnsResult {
  return {
    board_id: boardId,
    columns: [
      {
        group_id: 'g1',
        group_name: 'Todo',
        position: 0,
        color: null,
        total: 7,
        tasks: [task('t1')],
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getProject).mockResolvedValue(project);
});

describe('Overview', () => {
  it('renders an empty state when there are no boards', async () => {
    vi.mocked(api.getBoards).mockResolvedValue({
      results: [],
      pagination: { next_cursor: null, has_more: false, page_size: 50 },
    });
    render(
      <MemoryRouter>
        <Overview />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Demo')).toBeTruthy();
    expect(await screen.findByText('No boards yet')).toBeTruthy();
  });

  it('renders the project description through Markdown (bold becomes <strong>)', async () => {
    vi.mocked(api.getBoards).mockResolvedValue(boardsPage([]));
    const { container } = render(
      <MemoryRouter>
        <Overview />
      </MemoryRouter>,
    );
    await screen.findByText('Demo');
    expect(container.querySelector('strong')?.textContent).toBe('demo');
  });

  it('renders one strip per board with its columns + a +N more link', async () => {
    vi.mocked(api.getBoards).mockResolvedValue(
      boardsPage([summary('b1', 'Planning'), summary('b2', 'Execution')]),
    );
    vi.mocked(api.getBoardColumns).mockImplementation((id: string) => Promise.resolve(colsFor(id)));
    render(
      <MemoryRouter>
        <Overview />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Planning')).toBeTruthy();
    expect(screen.getByText('Execution')).toBeTruthy();
    // a mini-column with its count + a card
    expect(screen.getAllByText('Todo').length).toBe(2);
    expect(screen.getAllByText('Task t1').length).toBe(2);
    // +N more (7 total - 1 shown = 6), linking to the full board
    const more = screen.getAllByText('+6 more');
    expect(more.length).toBe(2);
    expect((more[0] as HTMLAnchorElement).getAttribute('href')).toContain('/boards/b1');
  });

  it('isolates a failing board: its strip shows an error, others still render', async () => {
    vi.mocked(api.getBoards).mockResolvedValue(
      boardsPage([summary('ok', 'Good Board'), summary('bad', 'Bad Board')]),
    );
    vi.mocked(api.getBoardColumns).mockImplementation((id: string) =>
      id === 'bad' ? Promise.reject(new Error('boom')) : Promise.resolve(colsFor(id)),
    );
    render(
      <MemoryRouter>
        <Overview />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('Good Board')).toBeTruthy());
    expect(screen.getByText('Bad Board')).toBeTruthy(); // header still rendered
    expect(screen.getByText(/Couldn’t load this board’s columns/)).toBeTruthy();
    // the good board still shows its column
    expect(screen.getByText('Todo')).toBeTruthy();
  });
});
