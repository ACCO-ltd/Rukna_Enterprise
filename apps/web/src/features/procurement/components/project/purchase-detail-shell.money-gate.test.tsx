import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

/**
 * ADR-043 review M2 — the PO settlement read carries money (bill totals, payments, advances) and
 * needs view:procurement + view:commitment-ledger. A Project Manager (procurement only) is simply
 * not offered the Funding and Settlement tabs, and the settlement read is never made; Receiving
 * reads its own money-free endpoint.
 */

const hooks = vi.hoisted(() => {
  const idle = () => ({ data: undefined, isPending: false, isError: false, mutate: vi.fn(), refetch: vi.fn() });
  return {
    usePurchaseOrder: vi.fn(),
    usePurchaseOrderSettlement: vi.fn(() => ({ isPending: true })),
    usePurchaseOrderReceiving: vi.fn(() => ({
      isPending: false,
      isError: false,
      data: { receivingStatus: 'NOT_RECEIVED', receivingLines: [] },
    })),
    useGoodsReceipts: vi.fn(() => ({ isPending: false, data: [] })),
    useConfirmPurchaseOrder: vi.fn(idle),
    useAttachPoRevision: vi.fn(idle),
    useCreateAdvanceReturn: vi.fn(idle),
    useCreateBuyerAdvance: vi.fn(idle),
    useCreateEvidenceAllocation: vi.fn(idle),
    usePoRevisionAttachments: vi.fn(() => ({ isPending: false, data: [] })),
    usePurchaseOrderBillPayments: vi.fn(() => ({ isPending: true })),
  };
});
vi.mock('../../hooks/use-procurement', async (original) => ({ ...(await original<object>()), ...hooks }));
vi.mock('@/features/accounting/hooks/use-accounting', async (original) => ({
  ...(await original<object>()),
  useBankAccounts: () => ({ data: [] }),
}));
vi.mock('@/features/users/hooks/use-users', () => ({ useUsers: () => ({ data: [] }) }));

import { PurchaseDetailShell } from './purchase-detail-shell';

const order = {
  id: 'po1',
  poNumber: 'PO-0007',
  status: 'OPEN',
  supplierId: 's1',
  currentRevisionId: 'r1',
  supplier: { id: 's1', code: 'S1', name: 'Supplier' },
  approvalInstanceId: null,
  closedAt: null,
  revisions: [
    {
      id: 'r1',
      revisionNumber: 1,
      status: 'ACTIVE',
      currencyCode: 'USD',
      effectiveFrom: '2026-09-01T00:00:00.000Z',
      reason: null,
      deliveryAddress: null,
      expectedDeliveryDate: null,
      approvedAt: null,
      approvedBy: null,
      quotationRef: null,
      quotationDate: null,
      quotedAmount: null,
      lines: [],
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  hooks.usePurchaseOrder.mockReturnValue({ isPending: false, isError: false, data: order });
});

describe('PurchaseDetailShell — money tabs follow the settlement gate', () => {
  it('a Project Manager (view:procurement only) gets no Funding / Settlement tab and no settlement read', () => {
    renderWithProviders(<PurchaseDetailShell projectId="p1" poId="po1" />, { permissions: ['view:procurement'] });
    expect(screen.queryByRole('button', { name: /^Funding/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /settlement$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Receiving/ })).toBeInTheDocument();
    expect(hooks.usePurchaseOrderSettlement).not.toHaveBeenCalled();
  });

  it('a Procurement Manager (plus view:commitment-ledger) gets both tabs', () => {
    renderWithProviders(<PurchaseDetailShell projectId="p1" poId="po1" />, {
      permissions: ['view:procurement', 'view:commitment-ledger'],
    });
    expect(screen.getByRole('button', { name: /^Funding/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /settlement$/i })).toBeInTheDocument();
  });
});
