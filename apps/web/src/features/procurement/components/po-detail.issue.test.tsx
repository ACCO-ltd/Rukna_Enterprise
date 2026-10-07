import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import type { PurchaseOrder } from '../types';

/**
 * QA (ADR-044): issuing a draft PO is `POST /purchase-orders/:id/confirm`, which the server gates on
 * create:purchase-order — the Procurement Manager who raised the order from a quotation award must
 * be able to issue it. Whether an approval is needed is the server's DoA gate, not this button.
 */

const fixture = vi.hoisted(() => ({ order: null as unknown }));
const draftOrder = {
  id: 'po7',
  poNumber: 'PO-00007',
  status: 'DRAFT',
  supplierId: 's9',
  currentRevisionId: 'rev1',
  supplier: { id: 's9', name: 'Xamar Steel' },
  approvalInstanceId: null,
  closedAt: null,
  revisions: [
    {
      id: 'rev1',
      revisionNumber: 1,
      status: 'DRAFT',
      currencyCode: 'USD',
      effectiveFrom: '2026-10-07',
      reason: null,
      deliveryAddress: null,
      expectedDeliveryDate: null,
      approvedAt: null,
      approvedBy: null,
      quotationRef: 'QR-00041',
      quotationDate: '2026-10-07',
      quotedAmount: '2295.00',
      lines: [],
    },
  ],
} as unknown as PurchaseOrder;

vi.mock('../hooks/use-procurement', async (original) => ({
  ...(await original<object>()),
  usePurchaseOrder: () => ({ data: fixture.order, isPending: false, isError: false }),
  useConfirmPurchaseOrder: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), reset: vi.fn(), isPending: false }),
  useCancelPurchaseOrder: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), reset: vi.fn(), isPending: false }),
  usePoRevisionAttachments: () => ({ data: [], isPending: false, isError: false }),
  usePurchaseOrderBillPayments: () => ({ isPending: true }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/procurement/orders/po7' }));

import { PoDetail } from './po-detail';

fixture.order = draftOrder;

describe('PoDetail — Issue purchase order', () => {
  it('is available to a buyer holding create:purchase-order (no approve permission needed)', () => {
    renderWithProviders(<PoDetail id="po7" />, { permissions: ['view:procurement', 'create:purchase-order'] });
    expect(screen.getByRole('button', { name: 'Issue purchase order' })).toBeEnabled();
  });

  it('is disabled without create:purchase-order', () => {
    renderWithProviders(<PoDetail id="po7" />, { permissions: ['view:procurement', 'approve:purchase-order'] });
    expect(screen.getByRole('button', { name: 'Issue purchase order' })).toBeDisabled();
  });
});
