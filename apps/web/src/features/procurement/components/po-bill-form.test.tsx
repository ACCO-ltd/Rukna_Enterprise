import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import type { GoodsReceipt, PurchaseOrder } from '../types';

/**
 * The PO-backed bill form (Slice ④, D6). The unit assertions pin the line rules that make the
 * 3-way match meaningful (quantity and price required); the rendered assertions prove the
 * PO picker → "System finds" flow and the inherited cost-target chip.
 */

const mocks = vi.hoisted(() => ({
  useCreateSupplierBill: vi.fn(),
  useSuppliers: vi.fn(),
  usePurchaseOrder: vi.fn(),
  usePurchaseOrders: vi.fn(),
  useGoodsReceipts: vi.fn(),
}));

const accountingMocks = vi.hoisted(() => ({
  useAccounts: vi.fn(),
  usePostingProfiles: vi.fn(),
}));

vi.mock('../hooks/use-procurement', () => mocks);
vi.mock('@/features/accounting/hooks/use-accounting', () => accountingMocks);
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn() }) }));

import { PoSupplierBillForm, poBillLineError, poBillTotalMinor } from './po-bill-form';

const PO: PurchaseOrder = {
  id: 'po-1',
  poNumber: 'PO-0042',
  status: 'OPEN',
  supplierId: 'sup-1',
  currentRevisionId: 'rev-1',
  supplier: { id: 'sup-1', name: 'ABC Trading' },
  approvalInstanceId: null,
  revisions: [
    {
      id: 'rev-1',
      revisionNumber: 1,
      status: 'ACTIVE',
      currencyCode: 'USD',
      effectiveFrom: '2026-08-01T00:00:00.000Z',
      reason: null,
      deliveryAddress: null,
      expectedDeliveryDate: null,
      approvedAt: '2026-08-01T00:00:00.000Z',
      approvedBy: 'user-1',
      lines: [
        {
          id: 'pol-1',
          lineNumber: 1,
          lineType: 'MATERIAL',
          description: '50kg cement bags',
          orderedQuantity: '285',
          unitPrice: '10.00',
          extendedAmount: '2850.00',
          materialId: 'mat-1',
          spendCategoryId: null,
          material: { code: 'CEM-50', name: 'Cement 50kg' },
          uom: { code: 'BAG', symbol: 'bag' },
          spendCategory: null,
          projectId: 'prj-1',
          boqNodeId: 'boq-1',
          project: { id: 'prj-1', code: 'WBR-26-0065', name: 'West Bank Road' },
          boqNode: { id: 'boq-1', code: '03.10', description: 'Concrete' },
        },
      ],
    },
  ],
};

const GRN_POSTED: GoodsReceipt = {
  id: 'grn-1',
  grnNumber: 'GR-0081',
  status: 'POSTED',
  purchaseOrderId: 'po-1',
  purchaseOrderRevisionId: 'rev-1',
  supplierId: 'sup-1',
  deliveryDate: '2026-08-10T00:00:00.000Z',
  deliveryNoteRef: null,
  postedAt: '2026-08-10T00:00:00.000Z',
  postedBy: null,
  lines: [
    {
      id: 'grl-1',
      lineNumber: 1,
      purchaseOrderLineId: 'pol-1',
      lineType: 'MATERIAL',
      orderedQuantity: '285',
      previouslyReceivedQty: '0',
      receivedQuantity: '185',
      acceptedQuantity: '185',
      rejectedQuantity: '0',
      rejectionReason: null,
      qualityStatus: 'ACCEPTED',
      notes: null,
      materialId: 'mat-1',
      material: { code: 'CEM-50', name: 'Cement 50kg' },
      uom: { code: 'BAG', symbol: 'bag' },
    },
  ],
};

const OFFICE = {
  id: 'a-cogs',
  code: '50303',
  status: 'ACTIVE',
  versions: [
    {
      id: 'v1',
      versionNumber: 1,
      name: 'Material Purchase',
      accountClass: 'COST_OF_SALES',
      accountSubtype: 'MATERIAL',
      normalBalance: 'DEBIT',
      isPostingAllowed: true,
      isControlAccount: false,
      controlledSubledgerType: null,
      controlPostingPolicy: 'UNRESTRICTED',
      parentAccountId: null,
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
    },
  ],
};

const PROFILE = {
  id: 'p-1',
  code: 'MATERIAL_PURCHASE',
  status: 'ACTIVE' as const,
  versions: [
    {
      id: 'pv-1',
      versionNumber: 1,
      name: 'Material Purchase (COGS)',
      description: null,
      accountId: 'a-cogs',
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useCreateSupplierBill.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  });
  mocks.useSuppliers.mockReturnValue({
    data: [
      {
        id: 'sup-1',
        code: 'SUP-001',
        name: 'ABC Trading',
        taxNumber: null,
        defaultCurrency: null,
        paymentTermsDays: null,
        status: 'ACTIVE',
      },
    ],
    isPending: false,
    isError: false,
  });
  mocks.usePurchaseOrders.mockReturnValue({ data: [PO], isPending: false, isError: false });
  mocks.usePurchaseOrder.mockReturnValue({ data: undefined, isPending: false, isError: false });
  mocks.useGoodsReceipts.mockReturnValue({ data: [], isPending: false, isError: false });
  accountingMocks.useAccounts.mockReturnValue({ data: [OFFICE], isPending: false, isError: false });
  accountingMocks.usePostingProfiles.mockReturnValue({
    data: [PROFILE],
    isPending: false,
    isError: false,
  });
});

describe('poBillLineError', () => {
  const valid = {
    poLineId: 'pol-1',
    description: 'Cement',
    quantity: '285',
    unitPrice: '10.00',
    netAmount: '2850.00',
    vatAmount: '0',
    expenseProfileCode: 'MATERIAL_PURCHASE',
    costTargetLabel: null,
  };

  it('accepts a complete PO-backed line', () => {
    expect(poBillLineError(valid)).toBeNull();
  });

  it('requires a positive quantity — it is what the match compares', () => {
    expect(poBillLineError({ ...valid, quantity: '0' })).toBe('quantity');
    expect(poBillLineError({ ...valid, quantity: '' })).toBe('quantity');
  });

  it('requires a unit price of zero or more', () => {
    expect(poBillLineError({ ...valid, unitPrice: '-1' })).toBe('unitPrice');
    expect(poBillLineError({ ...valid, unitPrice: '' })).toBe('unitPrice');
  });

  it('requires VAT to be typed, accepting an explicit zero', () => {
    expect(poBillLineError({ ...valid, vatAmount: '' })).toBe('vat');
    expect(poBillLineError({ ...valid, vatAmount: '0' })).toBeNull();
  });

  it('requires an expense profile', () => {
    expect(poBillLineError({ ...valid, expenseProfileCode: '' })).toBe('profile');
  });
});

describe('poBillTotalMinor', () => {
  const draft = (netAmount: string, vatAmount: string) => ({
    poLineId: 'x',
    description: 'x',
    quantity: '1',
    unitPrice: '1',
    netAmount,
    vatAmount,
    expenseProfileCode: 'MATERIAL_PURCHASE',
    costTargetLabel: null,
  });

  it('sums net plus VAT in minor units', () => {
    // 2850.00 + 0 + 100.00 + 5.00 = 2955.00 → 295500 minor units
    expect(poBillTotalMinor([draft('2850.00', '0'), draft('100.00', '5.00')])).toBe(295500);
  });
});

describe('PoSupplierBillForm', () => {
  it('offers a purchase-order field and disables it until a supplier is chosen', () => {
    renderWithProviders(<PoSupplierBillForm />);

    expect(screen.getByLabelText('Purchase order')).toBeInTheDocument();
    expect(screen.getByText(/Choose the supplier first/i)).toBeInTheDocument();
  });

  it('shows the "System finds" line from the resolved PO and its POSTED receipts, and seeds lines', async () => {
    const user = userEvent.setup();
    // Once a PO is chosen the detail + receipts resolve.
    mocks.usePurchaseOrder.mockReturnValue({ data: PO, isPending: false, isError: false });
    mocks.useGoodsReceipts.mockReturnValue({
      data: [GRN_POSTED],
      isPending: false,
      isError: false,
    });

    renderWithProviders(<PoSupplierBillForm />);

    await user.selectOptions(screen.getByLabelText('Supplier'), 'sup-1');
    await user.selectOptions(screen.getByLabelText('Purchase order'), 'po-1');

    await waitFor(() => {
      expect(screen.getByText('System finds')).toBeInTheDocument();
    });
    expect(screen.getByText('PO-0042')).toBeInTheDocument();
    expect(screen.getByText('GR-0081')).toBeInTheDocument();
    expect(screen.getByText(/185 accepted/)).toBeInTheDocument();
    // The line seeded from the PO carries its inherited cost-target chip, read-only.
    expect(screen.getByText(/WBR-26-0065 · 03\.10 Concrete/)).toBeInTheDocument();
  });
});
