import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import type { GoodsReceipt } from '../types';

/**
 * The goods-receipt detail: the over-receipt flag the server sets is shown, never a hold the
 * server did not apply.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/procurement/grn/grn-1',
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const { hooks, idle } = vi.hoisted(() => ({
  hooks: { receipt: vi.fn() },
  idle: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), reset: vi.fn(), isPending: false, error: null }),
}));

vi.mock('../hooks/use-procurement', () => ({
  useGoodsReceipt: () => hooks.receipt(),
  useCancelGoodsReceipt: idle,
  usePostGoodsReceipt: idle,
  useApproveGoodsReceiptException: idle,
  // Used by the form and list in the same module; not by the detail.
  useReceivablePurchaseOrders: vi.fn(),
  usePurchaseOrder: vi.fn(),
  useCreateGoodsReceipt: vi.fn(),
  useCreateReceiptException: vi.fn(),
  useGoodsReceipts: vi.fn(),
  usePurchaseOrders: vi.fn(),
  useSuppliers: vi.fn(),
}));

import { GrnDetail } from './grn-screens';

const RECEIPT: GoodsReceipt = {
  id: 'grn-1',
  grnNumber: 'GRN-00003',
  status: 'POSTED',
  purchaseOrderId: 'po1',
  purchaseOrderRevisionId: 'r1',
  supplierId: 's1',
  deliveryDate: '2026-09-25',
  deliveryNoteRef: 'DN-17',
  postedAt: '2026-09-25T10:00:00Z',
  postedBy: 'u1',
  overReceiptFlag: false,
  purchaseOrder: { id: 'po1', poNumber: 'PO-00007' },
  supplier: { id: 's1', name: 'Bakaal Steel' },
  lines: [
    {
      id: 'gl1',
      lineNumber: 1,
      purchaseOrderLineId: 'l1',
      lineType: 'MATERIAL',
      orderedQuantity: '100',
      previouslyReceivedQty: '0',
      receivedQuantity: '120',
      acceptedQuantity: '120',
      rejectedQuantity: '0',
      rejectionReason: null,
      qualityStatus: 'ACCEPTED',
      notes: null,
      materialId: 'm1',
      material: { code: 'CM-50', name: 'Cement 50kg' },
      uom: { code: 'BAG', symbol: 'bag' },
    },
  ],
};

const loaded = (data: GoodsReceipt) => ({ data, isPending: false, isError: false });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GrnDetail', () => {
  it('shows the over-receipt flag the server set, and no hold', () => {
    hooks.receipt.mockReturnValue(loaded({ ...RECEIPT, overReceiptFlag: true }));
    renderWithProviders(<GrnDetail id="grn-1" />);

    expect(screen.getByText('Over-receipt')).toBeInTheDocument();
    expect(screen.getByText(/recorded in full and flagged on the order/)).toBeInTheDocument();
    expect(screen.queryByText(/Held for over-receipt review/)).not.toBeInTheDocument();
  });

  it('shows no over-receipt notice on a clean receipt', () => {
    hooks.receipt.mockReturnValue(loaded(RECEIPT));
    renderWithProviders(<GrnDetail id="grn-1" />);

    expect(screen.queryByText('Over-receipt')).not.toBeInTheDocument();
  });

  it('links its purchase order, names the supplier, and labels the posted date', () => {
    hooks.receipt.mockReturnValue(loaded(RECEIPT));
    renderWithProviders(<GrnDetail id="grn-1" />);

    expect(screen.getByRole('link', { name: 'PO-00007' })).toHaveAttribute('href', '/procurement/orders/po1');
    expect(screen.getByText('Bakaal Steel')).toBeInTheDocument();
    expect(screen.getByText('Posted on')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Goods receipts' })).toHaveAttribute('href', '/procurement/grn');
  });
});
