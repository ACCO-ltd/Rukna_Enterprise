import { ClientStatus } from '@erp/types';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { createClient, updateClient, findClientDuplicateCandidates } from '../api/clients-api';
import type { Client } from '../types';
import { ClientForm } from './client-form';

const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('../api/clients-api', () => ({
  createClient: vi.fn(),
  updateClient: vi.fn(),
  findClientDuplicateCandidates: vi.fn(),
}));
const client: Client = {
  id: 'c1',
  organizationId: 'org-1',
  code: 'CL-001',
  taxNumber: null,
  defaultCurrency: 'USD',
  name: 'Ministry of Works',
  status: ClientStatus.ACTIVE,
  createdAt: '2026-09-09T00:00:00Z',
  updatedAt: '2026-09-09T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(findClientDuplicateCandidates).mockResolvedValue([]);
  vi.mocked(updateClient).mockResolvedValue(client);
  vi.mocked(createClient).mockResolvedValue(client);
});

describe('Client form handoff', () => {
  it('saves client edits without a hidden contact-name requirement', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ClientForm client={client} />, { withToast: true });
    expect(screen.queryByRole('textbox', { name: /Contact person/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(updateClient).toHaveBeenCalledWith(
        'c1',
        expect.objectContaining({ name: 'Ministry of Works' }),
      ),
    );
  });

  it('returns a created client to the calling project form without navigating', async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    renderWithProviders(<ClientForm onCreated={onCreated} />, { withToast: true });
    await user.type(screen.getByRole('textbox', { name: /^Name/ }), 'Ministry of Works');
    await user.type(screen.getByRole('textbox', { name: /Contact person/ }), 'Amina Yusuf');
    await user.click(screen.getByRole('button', { name: 'Create client' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(client));
    expect(push).not.toHaveBeenCalled();
  });
});
