import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import * as api from '../lib/api.js';
import { Overview } from './Overview.js';

vi.mock('../lib/api.js', async (orig) => {
  const actual = await orig<typeof import('../lib/api.js')>();
  return { ...actual, getProject: vi.fn(), getBoards: vi.fn() };
});

const project = {
  project_id: 'p1',
  project_name: 'Demo',
  description: 'A **demo** project',
  version: 1,
  schema_version: 2,
  created_at: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
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
    vi.mocked(api.getBoards).mockResolvedValue({
      results: [],
      pagination: { next_cursor: null, has_more: false, page_size: 50 },
    });
    const { container } = render(
      <MemoryRouter>
        <Overview />
      </MemoryRouter>,
    );
    await screen.findByText('Demo');
    expect(container.querySelector('strong')?.textContent).toBe('demo');
  });
});
