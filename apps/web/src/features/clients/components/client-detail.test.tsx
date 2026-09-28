import { ClientStatus } from '@erp/types';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { ClientDetail } from './client-detail';

const client = {
  id: 'c1',
  code: 'CLI-000001',
  name: 'Hayat Market',
  type: 'COMPANY',
  status: ClientStatus.ACTIVE as ClientStatus,
  notes: null,
  contacts: [],
};

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@/components/layout/module-chrome', () => ({ useModuleTrail: vi.fn() }));
vi.mock('../hooks/use-client', () => ({
  useClient: () => ({ isPending: false, isError: false, data: client }),
  useSetClientStatus: () => ({ isPending: false, isError: false, mutate: vi.fn(), reset: vi.fn() }),
}));
vi.mock('../hooks/use-clients', () => ({
  useClientSummaries: () => ({ data: [{ id: 'c1', activeProjectCount: 2, outstandingBalance: '1250.00' }] }),
}));
vi.mock('@/features/projects/hooks/use-projects', () => ({
  useProjects: () => ({ isPending: false, isError: false, data: [] }),
}));
vi.mock('./client-contacts', () => ({ ClientContacts: () => null }));

beforeEach(() => {
  client.status = ClientStatus.ACTIVE;
});

describe('ClientDetail — record header (ADR-035, flow plan B7)', () => {
  it('offers "New project" as the one primary action, prefilled with this client', () => {
    renderWithProviders(<ClientDetail clientId="c1" />, {
      permissions: ['create:project', 'manage:client'],
    });

    expect(screen.getByRole('heading', { level: 2, name: 'Hayat Market' })).toBeInTheDocument();
    expect(screen.getByText('CLI-000001')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New project' })).toHaveAttribute(
      'href',
      '/projects/new?clientId=c1',
    );
  });

  it('keeps Edit and deactivation in the kebab, deactivation last and marked destructive', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ClientDetail clientId="c1" />, { permissions: ['manage:client'] });

    await user.click(screen.getByRole('button', { name: 'More actions' }));
    const items = screen.getAllByRole('menuitem');
    expect(items[0]).toHaveTextContent('Edit');
    expect(items[0]).toHaveAttribute('href', '/clients/c1/edit');
    expect(items.at(-1)).toHaveTextContent('Deactivate');
    expect(items.at(-1)).toHaveClass('text-danger');
  });

  it('hides actions the reader cannot take', () => {
    renderWithProviders(<ClientDetail clientId="c1" />, { permissions: [] });
    expect(screen.queryByRole('link', { name: 'New project' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'More actions' })).not.toBeInTheDocument();
  });

  it('does not offer a new project for an inactive client', () => {
    client.status = ClientStatus.INACTIVE;
    renderWithProviders(<ClientDetail clientId="c1" />, {
      permissions: ['create:project', 'manage:client'],
    });
    expect(screen.queryByRole('link', { name: 'New project' })).not.toBeInTheDocument();
  });
});
