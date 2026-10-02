import { ClientStatus } from '@erp/types';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api-client';
import { chooseOption } from '@/test/choose-option';
import { renderWithProviders } from '@/test/render';

import { createClient, findClientDuplicateCandidates, updateClient } from '../api/clients-api';
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
  type: 'GOVERNMENT',
  status: ClientStatus.ACTIVE,
  createdAt: '2026-09-09T00:00:00Z',
  updatedAt: '2026-09-09T00:00:00Z',
  countryCode: 'SO',
  city: 'Mogadishu',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(findClientDuplicateCandidates).mockResolvedValue([]);
  vi.mocked(updateClient).mockResolvedValue(client);
  vi.mocked(createClient).mockResolvedValue(client);
});

async function fillRequired(user: UserEvent, { phone = '61 234 5678' } = {}) {
  await user.type(screen.getByRole('textbox', { name: /^Client name/ }), 'Ministry of Works');
  await user.type(screen.getByRole('textbox', { name: /^Contact person/ }), 'Amina Yusuf');
  await user.type(screen.getByRole('textbox', { name: /^Phone/ }), phone);
}

describe('ClientForm — create', () => {
  it('lays out Identity, Primary contact, Address and Billing, with notes folded away', () => {
    renderWithProviders(<ClientForm />, { withToast: true });
    for (const name of ['Identity', 'Primary contact', 'Address', 'Billing']) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: /Internal notes/ })).toHaveAttribute('aria-expanded', 'false');
    // The country-code picker defaults to Somalia +252.
    expect(screen.getByRole('combobox', { name: 'Country code' })).toHaveTextContent('+252');
    expect(screen.getByRole('combobox', { name: 'Country' })).toHaveTextContent('Somalia');
  });

  it('blocks the save until name, contact person and phone are given', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ClientForm />, { withToast: true });
    await user.click(screen.getByRole('button', { name: 'Save client' }));

    const box = (await screen.findByText('Fix 3 fields before saving')).closest('[role="alert"]') as HTMLElement;
    expect(within(box).getByRole('link', { name: 'Client name' })).toHaveAttribute('href', '#client-name');
    expect(within(box).getByRole('link', { name: 'Contact person' })).toHaveAttribute('href', '#client-contact-name');
    expect(within(box).getByRole('link', { name: 'Phone' })).toHaveAttribute('href', '#client-contact-phone');
    expect(createClient).not.toHaveBeenCalled();
  });

  it('rejects a phone number that is not valid for the selected country', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ClientForm />, { withToast: true });
    await fillRequired(user, { phone: '123' });
    await user.click(screen.getByRole('button', { name: 'Save client' }));

    expect(await screen.findAllByText('Enter a valid phone number for the selected country')).not.toHaveLength(0);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('sends the phone as E.164, WhatsApp the same number, and the billing fields', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ClientForm />, { withToast: true });
    await fillRequired(user);
    await user.type(screen.getByRole('textbox', { name: 'Registration no.' }), 'BL-2201');
    await user.type(screen.getByRole('textbox', { name: 'Tax ID' }), ' SO123456789 ');
    await user.type(screen.getByRole('textbox', { name: 'City' }), 'Mogadishu');
    await user.type(screen.getByRole('textbox', { name: 'Street and building' }), 'Maka Al Mukarama Road');
    await user.type(screen.getByRole('textbox', { name: /^Payment terms/ }), '30');
    await user.click(screen.getByRole('button', { name: 'Save client' }));

    await waitFor(() =>
      expect(createClient).toHaveBeenCalledWith({
        name: 'Ministry of Works',
        type: 'COMPANY',
        countryCode: 'SO',
        registrationNumber: 'BL-2201',
        taxNumber: 'SO123456789',
        city: 'Mogadishu',
        address: 'Maka Al Mukarama Road',
        paymentTermsDays: 30,
        primaryContact: { name: 'Amina Yusuf', phone: '+252612345678', whatsappPhone: '+252612345678' },
      }),
    );
  });

  it('takes a separate WhatsApp number when "same" is unticked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ClientForm />, { withToast: true });
    await fillRequired(user);
    await user.click(screen.getByRole('checkbox', { name: 'Use this number for WhatsApp' }));
    await user.type(screen.getByRole('textbox', { name: 'WhatsApp number' }), '61 666 6666');
    await user.click(screen.getByRole('button', { name: 'Save client' }));

    await waitFor(() =>
      expect(createClient).toHaveBeenCalledWith(
        expect.objectContaining({
          primaryContact: expect.objectContaining({ phone: '+252612345678', whatsappPhone: '+252616666666' }),
        }),
      ),
    );
  });

  it('switches an individual to "Full name" and drops the job title', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ClientForm />, { withToast: true });
    expect(screen.getByRole('textbox', { name: /^Job title/ })).toBeInTheDocument();
    await chooseOption(user, screen.getByRole('combobox', { name: /^Client type/ }), 'INDIVIDUAL');
    expect(screen.getByRole('textbox', { name: /^Full name/ })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /^Job title/ })).not.toBeInTheDocument();
  });

  it('warns about a personal address on an organisation and offers a typo fix', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ClientForm />, { withToast: true });
    const email = screen.getByRole('textbox', { name: 'Email' });
    await user.type(email, 'amina@gmial.com');
    expect(screen.getByText('Did you mean amina@gmail.com?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Use amina@gmail.com' }));
    expect(email).toHaveValue('amina@gmail.com');
    expect(screen.getByText(/looks like a personal address/)).toBeInTheDocument();

    // An individual is expected to use a personal address.
    await chooseOption(user, screen.getByRole('combobox', { name: /^Client type/ }), 'INDIVIDUAL');
    expect(screen.queryByText(/looks like a personal address/)).not.toBeInTheDocument();
  });

  it('flags a malformed email', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ClientForm />, { withToast: true });
    await fillRequired(user);
    await user.type(screen.getByRole('textbox', { name: 'Email' }), 'amina@');
    await user.click(screen.getByRole('button', { name: 'Save client' }));
    expect(await screen.findAllByText('Enter a valid email address')).not.toHaveLength(0);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('puts a server PHONE_INVALID at the phone field in plain words', async () => {
    vi.mocked(createClient).mockRejectedValue(
      new ApiError(400, 'phone invalid', 'PHONE_INVALID', [], { field: 'primaryContact.phone' }),
    );
    const user = userEvent.setup();
    renderWithProviders(<ClientForm />, { withToast: true });
    await fillRequired(user);
    await user.click(screen.getByRole('button', { name: 'Save client' }));
    expect(await screen.findAllByText('That phone number is not valid for the selected country.')).not.toHaveLength(0);
  });

  it('warns about a possible duplicate name without blocking the save', async () => {
    const user = userEvent.setup();
    vi.mocked(findClientDuplicateCandidates).mockResolvedValue([
      { id: 'c9', name: 'Ministry of Works', type: 'GOVERNMENT', status: ClientStatus.ACTIVE },
    ]);
    renderWithProviders(<ClientForm />, { withToast: true });
    await fillRequired(user);
    expect(await screen.findByText('A client with a similar name may already exist.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Ministry of Works/ })).toHaveAttribute('href', '/clients/c9');
    await user.click(screen.getByRole('button', { name: 'Save client' }));
    await waitFor(() => expect(createClient).toHaveBeenCalled());
  });

  it('returns a created client to the calling project form without navigating', async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    renderWithProviders(<ClientForm onCreated={onCreated} />, { withToast: true });
    await fillRequired(user);
    await user.click(screen.getByRole('button', { name: 'Save client' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(client));
    expect(push).not.toHaveBeenCalled();
  });
});

describe('ClientForm — edit', () => {
  it('has no contact section and patches client fields only', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ClientForm client={client} />, { withToast: true });
    expect(screen.queryByRole('textbox', { name: /^Contact person/ })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'City' })).toHaveValue('Mogadishu');
    await user.type(screen.getByRole('textbox', { name: 'Tax ID' }), 'SO-77');
    await user.clear(screen.getByRole('textbox', { name: 'City' }));
    await user.click(screen.getByRole('button', { name: 'Save client' }));
    await waitFor(() =>
      expect(updateClient).toHaveBeenCalledWith(
        'c1',
        expect.objectContaining({ name: 'Ministry of Works', type: 'GOVERNMENT', taxNumber: 'SO-77', city: null }),
      ),
    );
    expect(vi.mocked(updateClient).mock.calls[0]![1]).not.toHaveProperty('status');
  });
});
