import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api-client';
import { renderWithProviders } from '@/test/render';

import { detailFixture } from '../../quotations/test-fixtures';
import type { MaterialRequest } from '../../types';

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav }));
const api = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('../../api/quotations-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  openQuotationRequest: (...args: unknown[]) => api.open(...args),
}));

import { GetQuotesEntry } from './get-quotes-entry';

const mr = (patch: Partial<MaterialRequest> = {}): MaterialRequest => ({
  id: 'mr1',
  mrNumber: 'MR-00123',
  requestScope: 'PROJECT',
  projectId: 'p1',
  status: 'APPROVED',
  approvalInstanceId: null,
  requestedBy: 'u2',
  requestedDate: '2026-10-01',
  requiredByDate: null,
  description: null,
  notes: null,
  lines: [],
  ...patch,
});

beforeEach(() => {
  vi.clearAllMocks();
  api.open.mockResolvedValue(detailFixture());
});

describe('GetQuotesEntry (wireframe A)', () => {
  it('opens the camera and the request in the same tap on an approved MR', async () => {
    const user = userEvent.setup();
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    renderWithProviders(<GetQuotesEntry request={mr()} />, { permissions: ['collect:quotation'] });

    await user.click(screen.getByRole('button', { name: 'Get quotes' }));
    expect(click).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(api.open).toHaveBeenCalledWith('mr1'));
    click.mockRestore();
  });

  it('links to the open request with its count', () => {
    renderWithProviders(
      <GetQuotesEntry
        request={mr({ quotation: { id: 'qr1', status: 'COLLECTING', quoteCount: 2, requiredQuoteCount: 3 } })}
      />,
      { permissions: ['collect:quotation'] },
    );
    expect(screen.getByRole('link', { name: /Quotes 2 of 3/ })).toHaveAttribute('href', '/procurement/quotes/qr1');
  });

  it('sends a finance selector to the decision screen instead', () => {
    renderWithProviders(
      <GetQuotesEntry
        request={mr({ quotation: { id: 'qr1', status: 'AWAITING_DECISION', quoteCount: 3, requiredQuoteCount: 3 } })}
      />,
      { permissions: ['award:quotation'] },
    );
    expect(screen.getByRole('link', { name: /Quotes 3 of 3/ })).toHaveAttribute('href', '/finance/quotes/qr1');
  });

  it('offers nothing without the permission or before approval', () => {
    const { unmount } = renderWithProviders(<GetQuotesEntry request={mr()} />, { permissions: ['view:procurement'] });
    expect(screen.queryByRole('button', { name: 'Get quotes' })).not.toBeInTheDocument();
    unmount();
    renderWithProviders(<GetQuotesEntry request={mr({ status: 'SUBMITTED' })} />, {
      permissions: ['collect:quotation'],
    });
    expect(screen.queryByRole('button', { name: 'Get quotes' })).not.toBeInTheDocument();
  });

  it('offers Get quotes again once a round closed with quantity left (summary null)', () => {
    renderWithProviders(<GetQuotesEntry request={mr({ status: 'PARTIALLY_ORDERED', quotation: null })} />, {
      permissions: ['collect:quotation'],
    });
    expect(screen.getByRole('button', { name: 'Get quotes' })).toBeInTheDocument();
  });

  it('says when everything is already ordered (409 MATERIAL_REQUEST_ALREADY_ORDERED)', async () => {
    const user = userEvent.setup();
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    api.open.mockRejectedValue(
      new ApiError(409, 'Ordered', 'MATERIAL_REQUEST_ALREADY_ORDERED', [], { code: 'MATERIAL_REQUEST_ALREADY_ORDERED' }),
    );
    renderWithProviders(<GetQuotesEntry request={mr()} />, { permissions: ['collect:quotation'] });
    await user.click(screen.getByRole('button', { name: 'Get quotes' }));
    expect(await screen.findByText('Everything on this request is already ordered.')).toBeInTheDocument();
    click.mockRestore();
  });
});
