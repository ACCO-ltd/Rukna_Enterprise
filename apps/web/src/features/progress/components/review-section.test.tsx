import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

const mocks = vi.hoisted(() => ({ useDprs: vi.fn() }));

vi.mock('../hooks/use-progress', () => ({ useDprs: mocks.useDprs }));
vi.mock('./dpr-detail', () => ({ DprDetail: ({ dprId }: { dprId: string }) => <p>detail {dprId}</p> }));

import { ReviewSection } from './review-section';

beforeEach(() => {
  mocks.useDprs.mockReturnValue({
    isPending: false,
    isError: false,
    data: [
      { id: 'a', reportDate: '2026-09-26', status: 'SUBMITTED', preparedBy: 'u1', preparedByName: 'Omar Ali' },
      { id: 'b', reportDate: '2026-09-27', status: 'SUBMITTED', preparedBy: 'u2', preparedByName: 'Amina Yusuf' },
    ],
  });
});

describe('ReviewSection', () => {
  it('renders the queue on the shared listbox and opens the selected report with the keyboard', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReviewSection projectId="p1" />, { permissions: ['approve:progress'] });

    const list = screen.getByRole('listbox', { name: 'Awaiting review' });
    expect(screen.getAllByRole('option')).toHaveLength(2);
    expect(screen.getByText('Omar Ali')).toBeInTheDocument();

    list.focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('detail a')).toBeInTheDocument();
  });
});
