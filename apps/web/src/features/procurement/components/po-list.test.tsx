import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { usePurchaseOrders } from '../hooks/use-procurement';
import { PoList } from './po-list';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('projectId=p1'),
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/procurement/orders',
}));
vi.mock('@/features/projects/hooks/use-projects', () => ({
  useProjects: () => ({ data: [{ id: 'p1', code: 'ACCO-HDN-26-0005', name: 'acco' }] }),
}));
vi.mock('../hooks/use-procurement', () => ({
  usePurchaseOrders: vi.fn(() => ({ data: [], isPending: false, isError: false })),
}));

describe('PoList — project filter', () => {
  it('opens already narrowed to the project a workspace linked from', () => {
    renderWithProviders(<PoList />);
    expect(vi.mocked(usePurchaseOrders)).toHaveBeenCalledWith({ projectId: 'p1' });
    // The Project filter shows the pre-selected project.
    expect(screen.getByText('ACCO-HDN-26-0005 · acco')).toBeInTheDocument();
  });
});
