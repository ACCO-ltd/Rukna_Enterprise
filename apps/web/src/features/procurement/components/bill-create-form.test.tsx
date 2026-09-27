import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api-client';
import { renderWithProviders } from '@/test/render';
import { chooseOption, openSelect } from '@/test/choose-option';
import { pickDate } from '@/test/pick-date';

import type { GoodsReceipt, PurchaseOrder, Supplier, SupplierBill } from '../types';

/**
 * The one New bill page (ADR-037), replacing the non-PO `bill-form` and the PO `po-bill-form`.
 * Every rendered assertion those two forms' tests made is kept here against the new page; the
 * line rules they pinned moved with the logic to `bill-create.test.ts`.
 *
 * Rendering against the real catalogue proves every key the page asks for exists.
 */

const mocks = vi.hoisted(() => ({
  useCreateSupplierBill: vi.fn(),
  useUpdateSupplierBill: vi.fn(),
  useSupplierBill: vi.fn(),
  useSuppliers: vi.fn(),
  useSupplierBills: vi.fn(),
  // SupplierPicker offers "New supplier" from the picker itself.
  useCreateSupplier: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null, reset: vi.fn() }),
  usePurchaseOrder: vi.fn(),
  usePurchaseOrders: vi.fn(),
  useGoodsReceipts: vi.fn(),
  useSpendCategories: vi.fn(),
}));

const accountingMocks = vi.hoisted(() => ({
  useAccounts: vi.fn(),
  usePostingProfiles: vi.fn(),
}));

const projectMocks = vi.hoisted(() => ({ useProjects: vi.fn() }));
const boqMocks = vi.hoisted(() => ({ useBoqWorkspace: vi.fn(), useBoqTree: vi.fn() }));
const routerMocks = vi.hoisted(() => ({ push: vi.fn(), back: vi.fn() }));

vi.mock('../hooks/use-procurement', () => mocks);
vi.mock('@/features/accounting/hooks/use-accounting', () => accountingMocks);
vi.mock('@/features/projects/hooks/use-projects', () => projectMocks);
vi.mock('@/features/boq/hooks/use-boq', () => boqMocks);
vi.mock('next/navigation', () => ({ useRouter: () => routerMocks, usePathname: () => '/finance/accounting/bills/new' }));

import { SupplierBillCreateForm, SupplierBillEditPage } from './bill-create-form';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SUPPLIER: Supplier = {
  id: 'sup-1',
  code: 'SUP-001',
  name: 'ABC Trading',
  taxNumber: null,
  defaultCurrency: null,
  paymentTermsDays: 30,
  address: null,
  status: 'ACTIVE',
};

const NO_TERMS: Supplier = { ...SUPPLIER, id: 'sup-2', code: 'SUP-002', name: 'Horn Cement', paymentTermsDays: null };

const PO: PurchaseOrder = {
  id: 'po-1',
  poNumber: 'PO-0042',
  status: 'OPEN',
  supplierId: 'sup-1',
  currentRevisionId: 'rev-1',
  supplier: { id: 'sup-1', name: 'ABC Trading' },
  approvalInstanceId: null,
  closedAt: null,
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
      quotationRef: null,
      quotationDate: null,
      quotedAmount: null,
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

const ACCOUNT = {
  id: 'a-office',
  code: '60100',
  status: 'ACTIVE',
  versions: [
    {
      id: 'v1',
      versionNumber: 1,
      name: 'Office & Admin',
      accountClass: 'EXPENSE',
      accountSubtype: 'ADMIN_EXPENSE',
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
  code: 'OFFICE_EXPENSE',
  status: 'ACTIVE' as const,
  versions: [
    {
      id: 'pv-1',
      versionNumber: 1,
      name: 'Office & Admin Expense',
      description: null,
      accountId: 'a-office',
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
    },
  ],
};

const loaded = <T,>(data: T) => ({ data, isPending: false, isLoading: false, isError: false });

const mutate = vi.fn();

function createState(over: Record<string, unknown> = {}) {
  return { mutate, reset: vi.fn(), isPending: false, isSuccess: false, isError: false, error: null, ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useCreateSupplierBill.mockReturnValue(createState());
  mocks.useUpdateSupplierBill.mockReturnValue(createState());
  mocks.useSupplierBill.mockReturnValue({ data: undefined, isPending: true, isError: false });
  mocks.useSuppliers.mockReturnValue(loaded([SUPPLIER, NO_TERMS]));
  mocks.useSupplierBills.mockReturnValue(loaded([]));
  mocks.usePurchaseOrders.mockReturnValue(loaded([PO]));
  mocks.usePurchaseOrder.mockReturnValue({ data: undefined, isPending: false, isError: false });
  mocks.useGoodsReceipts.mockReturnValue(loaded([]));
  mocks.useSpendCategories.mockReturnValue(loaded([]));
  accountingMocks.useAccounts.mockReturnValue(loaded([ACCOUNT]));
  accountingMocks.usePostingProfiles.mockReturnValue(loaded([PROFILE]));
  projectMocks.useProjects.mockReturnValue(loaded([{ id: 'prj-1', code: 'WBR-26-0065', name: 'West Bank Road' }]));
  boqMocks.useBoqWorkspace.mockReturnValue(loaded({ contractBaseline: null, approved: null }));
  boqMocks.useBoqTree.mockReturnValue(loaded([]));
});

const byId = (id: string) => document.getElementById(id) as HTMLElement;

// ─── Direct expense ───────────────────────────────────────────────────────────

describe('SupplierBillCreateForm — direct expense', () => {
  /**
   * A direct bill has no purchase order, and must not offer one: matching does not apply, and
   * the choice between the two kinds is the first question on the page, said in words.
   */
  it('asks what the bill is for, and offers no purchase-order field on a direct bill', () => {
    renderWithProviders(<SupplierBillCreateForm initialKind="direct" />);

    expect(screen.getByRole('radio', { name: /direct expense/i })).toBeChecked();
    expect(screen.getByText(/matching doesn't apply/i)).toBeInTheDocument();
    expect(byId('bill-purchase-order')).toBeNull();
  });

  it('offers the supplier, invoice number, project and both dates', () => {
    renderWithProviders(<SupplierBillCreateForm initialKind="direct" />);

    expect(screen.getByLabelText(/^Supplier\*?$/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Supplier invoice number/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Project/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Bill date/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Due date/)).toBeInTheDocument();
    expect(screen.getByText("As printed on the supplier's invoice.")).toBeInTheDocument();
  });

  it('shows the lifecycle at Draft and says what saving does', () => {
    renderWithProviders(<SupplierBillCreateForm initialKind="direct" />);

    expect(screen.getByText(/The number is assigned when you save/)).toBeInTheDocument();
    expect(screen.getByText('Not saved yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save bill' })).toBeInTheDocument();
  });

  it('offers only expense profiles in the line picker', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SupplierBillCreateForm initialKind="direct" />);

    await openSelect(user, byId('bill-line-0-profile'));
    expect(screen.getByRole('option', { name: /Office & Admin Expense/ })).toBeInTheDocument();
  });

  /**
   * Every line requires a profile. With none resolvable the only required select would be
   * empty and every save would 400, so the page says what is wrong and withholds Save.
   */
  it('blocks the form when no expense profile resolves', () => {
    accountingMocks.usePostingProfiles.mockReturnValue(loaded([]));
    renderWithProviders(<SupplierBillCreateForm initialKind="direct" />);

    expect(screen.getByText(/No expense posting profile is configured/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save bill' })).toBeDisabled();
  });

  it('refuses an empty save and lists every invalid field in a counted summary', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SupplierBillCreateForm initialKind="direct" />);

    await user.click(screen.getByRole('button', { name: 'Save bill' }));

    expect(mutate).not.toHaveBeenCalled();
    const summary = screen.getByText(/^Fix \d+ fields? before saving$/).closest('[role="alert"]') as HTMLElement;
    expect(within(summary).getByRole('link', { name: 'Supplier' })).toBeInTheDocument();
    expect(within(summary).getByRole('link', { name: 'Supplier invoice number' })).toBeInTheDocument();
    expect(within(summary).getByRole('link', { name: 'Project' })).toBeInTheDocument();
    expect(within(summary).getByRole('link', { name: 'Line 1 — Description' })).toBeInTheDocument();
    expect(within(summary).getByRole('link', { name: 'Line 1 — VAT' })).toBeInTheDocument();
  });

  it('saves an overhead bill with the payload POST /bills expects, then opens it', async () => {
    const user = userEvent.setup();
    mutate.mockImplementation((_payload, options) => options.onSuccess({ id: 'bill-9' }));
    renderWithProviders(<SupplierBillCreateForm initialKind="direct" />);

    await chooseOption(user, byId('bill-supplier'), 'sup-2');
    await user.type(byId('bill-invoice-number'), 'INV-77');
    await chooseOption(user, byId('bill-project'), 'none');
    await pickDate(user, byId('bill-date'), '2026-09-10');
    await pickDate(user, byId('bill-due-date'), '2026-10-10');
    await user.type(byId('bill-line-0-description'), 'Office rent');
    await chooseOption(user, byId('bill-line-0-profile'), 'OFFICE_EXPENSE');
    await user.type(byId('bill-line-0-unitPrice'), '400');
    await user.type(byId('bill-line-0-vat'), '0');

    await user.click(screen.getByRole('button', { name: 'Save bill' }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]![0]).toEqual({
      supplierId: 'sup-2',
      supplierInvoiceNumber: 'INV-77',
      billDate: '2026-09-10',
      dueDate: '2026-10-10',
      currencyCode: 'USD',
      lines: [
        {
          description: 'Office rent',
          quantity: 1,
          unitPrice: 400,
          netAmount: 400,
          vatAmount: 0,
          expenseProfileCode: 'OFFICE_EXPENSE',
        },
      ],
    });
    expect(routerMocks.push).toHaveBeenCalledWith('/finance/accounting/bills/bill-9');
  });

  it('lets the clerk type a net over qty × price, warns by how much it differs, and saves it', async () => {
    const user = userEvent.setup();
    mutate.mockImplementation((_payload, options) => options.onSuccess({ id: 'bill-9' }));
    renderWithProviders(<SupplierBillCreateForm initialKind="direct" />);

    await chooseOption(user, byId('bill-supplier'), 'sup-2');
    await user.type(byId('bill-invoice-number'), 'INV-78');
    await chooseOption(user, byId('bill-project'), 'none');
    await pickDate(user, byId('bill-date'), '2026-09-10');
    await pickDate(user, byId('bill-due-date'), '2026-10-10');
    await user.type(byId('bill-line-0-description'), 'Cement');
    await chooseOption(user, byId('bill-line-0-profile'), 'OFFICE_EXPENSE');
    await user.clear(byId('bill-line-0-quantity'));
    await user.type(byId('bill-line-0-quantity'), '200');
    await user.type(byId('bill-line-0-unitPrice'), '9.50');
    await user.type(byId('bill-line-0-vat'), '0');

    // Calculated until the clerk types: the product is the placeholder.
    expect(byId('bill-line-0-amount')).toHaveAttribute('placeholder', '1,900.00');
    await user.type(byId('bill-line-0-amount'), '1995');
    expect(
      screen.getByText(/Amount is \$95\.00 more than 200 × \$9\.50 \(\$1,900\.00\)/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save bill' }));
    expect(mutate.mock.calls[0]![0].lines[0]).toMatchObject({ quantity: 200, unitPrice: 9.5, netAmount: 1995 });
  });

  it('goes back to qty × price when the typed net is reset', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SupplierBillCreateForm initialKind="direct" />);

    await user.type(byId('bill-line-0-unitPrice'), '400');
    await user.type(byId('bill-line-0-amount'), '395');
    expect(screen.getByText(/Amount is \$5\.00 less than/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Use qty × price' }));
    expect(byId('bill-line-0-amount')).toHaveValue('');
    expect(screen.queryByText(/Amount is .* than/)).not.toBeInTheDocument();
  });

  it("sets the due date from the supplier's payment terms, and says so", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SupplierBillCreateForm initialKind="direct" />);

    await chooseOption(user, byId('bill-supplier'), 'sup-1');
    await pickDate(user, byId('bill-date'), '2026-09-10');

    expect(screen.getByText("Set from the supplier's payment terms (Net 30).")).toBeInTheDocument();
    expect(byId('bill-due-date')).toHaveTextContent(/Oct(ober)? 10, 2026|10 Oct(ober)? 2026/);
  });

  it('asks for the due date by hand when the supplier has no terms', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SupplierBillCreateForm initialKind="direct" />);

    await chooseOption(user, byId('bill-supplier'), 'sup-2');
    expect(screen.getByText(/has no payment terms recorded/i)).toBeInTheDocument();
  });

  /**
   * The server keys duplicates on the normalised number, so the warning must too: "inv 5531"
   * is the same invoice as "INV-5531". A warning, not an error — but it says plainly that the
   * server will refuse it.
   */
  it('warns when the supplier already has a bill with this invoice number', async () => {
    const user = userEvent.setup();
    mocks.useSupplierBills.mockReturnValue(
      loaded([{ id: 'b1', billNumber: 'BILL-2026-0042', supplierId: 'sup-1', supplierInvoiceNumber: 'INV-5531' } as SupplierBill]),
    );
    renderWithProviders(<SupplierBillCreateForm initialKind="direct" />);

    await chooseOption(user, byId('bill-supplier'), 'sup-1');
    await user.type(byId('bill-invoice-number'), 'inv 5531');

    expect(mocks.useSupplierBills).toHaveBeenLastCalledWith({ supplierId: 'sup-1' }, { enabled: true });
    expect(screen.getByText(/inv 5531 is already recorded on BILL-2026-0042/)).toBeInTheDocument();
    expect(screen.getByText(/will not accept a second bill with this number/)).toBeInTheDocument();
  });

  it('shows a 409 from the server as an error on the invoice-number field', () => {
    mocks.useCreateSupplierBill.mockReturnValue(
      createState({
        isError: true,
        error: new ApiError(409, 'Supplier invoice INV-5531 is already recorded on BILL-2026-0042', 'CONFLICT'),
      }),
    );
    renderWithProviders(<SupplierBillCreateForm initialKind="direct" />);

    expect(byId('bill-invoice-number-error')).toHaveTextContent(
      'Supplier invoice INV-5531 is already recorded on BILL-2026-0042',
    );
    expect(screen.getByRole('link', { name: 'Supplier invoice number' })).toBeInTheDocument();
  });

  it('asks each line of a project bill what the cost is for', async () => {
    const user = userEvent.setup();
    mocks.useSpendCategories.mockReturnValue(
      loaded([{ id: 'c1', code: 'SEC', name: 'Site security', status: 'ACTIVE' }]),
    );
    renderWithProviders(<SupplierBillCreateForm initialKind="direct" />);

    expect(byId('bill-line-0-costLine')).toBeNull();
    await chooseOption(user, byId('bill-project'), 'prj-1');

    await openSelect(user, byId('bill-line-0-costLine'));
    expect(screen.getByRole('option', { name: 'SEC · Site security' })).toBeInTheDocument();
  });
});

// ─── Against a purchase order ─────────────────────────────────────────────────

describe('SupplierBillCreateForm — against a purchase order', () => {
  it('opens on the PO choice, with the purchase-order field disabled until a supplier is chosen', () => {
    renderWithProviders(<SupplierBillCreateForm initialKind="po" />);

    expect(screen.getByRole('radio', { name: /against a purchase order/i })).toBeChecked();
    expect(screen.getByLabelText(/^Purchase order/)).toBeInTheDocument();
    expect(screen.getByText(/Choose the supplier first/i)).toBeInTheDocument();
  });

  it('shows "System finds", seeds one line per PO line with ordered and received, and the inherited chip', async () => {
    const user = userEvent.setup();
    mocks.usePurchaseOrder.mockReturnValue({ data: PO, isPending: false, isError: false });
    mocks.useGoodsReceipts.mockReturnValue(loaded([GRN_POSTED]));
    renderWithProviders(<SupplierBillCreateForm initialKind="po" />);

    await chooseOption(user, byId('bill-supplier'), 'sup-1');
    await chooseOption(user, byId('bill-purchase-order'), 'po-1');

    await waitFor(() => expect(screen.getByText('System finds')).toBeInTheDocument());
    expect(screen.getByText('PO-0042')).toBeInTheDocument();
    expect(screen.getByText('GR-0081')).toBeInTheDocument();
    expect(screen.getByText(/185 accepted/)).toBeInTheDocument();
    expect(screen.getByText('50kg cement bags')).toBeInTheDocument();
    expect(screen.getByText('285 bag')).toBeInTheDocument();
    expect(screen.getByText('185 bag')).toBeInTheDocument();
    // The line carries its inherited cost-target chip, read-only (D7).
    expect(screen.getByText(/WBR-26-0065 · 03\.10 Concrete/)).toBeInTheDocument();
    // Seeded at the ordered 285 against 185 received — the over-billing note says so.
    expect(
      screen.getByText('Billing 100 bag more than received on GR-0081 — the match will likely raise an exception.'),
    ).toBeInTheDocument();
  });

  it('clears the note once the billed quantity is within what was received', async () => {
    const user = userEvent.setup();
    mocks.usePurchaseOrder.mockReturnValue({ data: PO, isPending: false, isError: false });
    mocks.useGoodsReceipts.mockReturnValue(loaded([GRN_POSTED]));
    renderWithProviders(<SupplierBillCreateForm initialKind="po" />);

    await chooseOption(user, byId('bill-supplier'), 'sup-1');
    await chooseOption(user, byId('bill-purchase-order'), 'po-1');
    const qty = byId('bill-line-0-quantity');
    await user.clear(qty);
    await user.type(qty, '185');

    expect(screen.queryByText(/more than received/)).not.toBeInTheDocument();
  });

  it('saves the PO bill with the computed net and no cost coding', async () => {
    const user = userEvent.setup();
    mocks.usePurchaseOrder.mockReturnValue({ data: PO, isPending: false, isError: false });
    mocks.useGoodsReceipts.mockReturnValue(loaded([GRN_POSTED]));
    renderWithProviders(<SupplierBillCreateForm initialKind="po" />);

    await chooseOption(user, byId('bill-supplier'), 'sup-1');
    await chooseOption(user, byId('bill-purchase-order'), 'po-1');
    await user.type(byId('bill-invoice-number'), 'INV-9044');
    await pickDate(user, byId('bill-date'), '2026-09-01');
    await chooseOption(user, byId('bill-line-0-profile'), 'OFFICE_EXPENSE');
    await user.type(byId('bill-line-0-vat'), '0');

    await user.click(screen.getByRole('button', { name: 'Save bill' }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]![0]).toEqual({
      supplierId: 'sup-1',
      purchaseOrderId: 'po-1',
      supplierInvoiceNumber: 'INV-9044',
      billDate: '2026-09-01',
      // Net 30 from the supplier's terms.
      dueDate: '2026-10-01',
      currencyCode: 'USD',
      lines: [
        {
          description: '50kg cement bags',
          quantity: 285,
          unitPrice: 10,
          netAmount: 2850,
          vatAmount: 0,
          expenseProfileCode: 'OFFICE_EXPENSE',
        },
      ],
    });
  });
});

// ─── Edit a draft (ADR-037 amendment) ─────────────────────────────────────────

const DRAFT_DIRECT = {
  id: 'bill-7',
  billNumber: 'BILL-2026-0042',
  supplierId: 'sup-2',
  supplier: { id: 'sup-2', code: 'SUP-002', name: 'Horn Cement' },
  supplierInvoiceNumber: 'INV-77',
  billDate: '2026-09-10T00:00:00.000Z',
  dueDate: '2026-10-10T00:00:00.000Z',
  currencyCode: 'USD',
  documentStatus: 'DRAFT',
  postingStatus: 'NOT_POSTED',
  matchStatus: 'NOT_RUN',
  purchaseOrderId: null,
  purchaseOrderRevisionId: null,
  projectId: null,
  subtotal: '5660.00',
  vatAmount: '0.00',
  totalAmount: '5660.00',
  outstandingAmount: '5660.00',
  returnedAt: '2026-09-20T10:00:00.000Z',
  returnReason: 'Amount is $5,060, not $5,660.',
  lines: [
    {
      id: 'bl-1',
      lineNumber: 1,
      description: 'Office rent',
      quantity: '1.0000',
      unitPrice: '5660.0000',
      netAmount: '5660.00',
      vatAmount: '0.00',
      grossAmount: '5660.00',
      expenseProfileCode: 'OFFICE_EXPENSE',
      projectId: null,
      boqNodeId: null,
    },
  ],
} as unknown as SupplierBill;

const DRAFT_PO = {
  ...DRAFT_DIRECT,
  id: 'bill-8',
  billNumber: null,
  supplierId: 'sup-1',
  supplier: { id: 'sup-1', code: 'SUP-001', name: 'ABC Trading' },
  supplierInvoiceNumber: 'INV-9044',
  billDate: '2026-09-01T00:00:00.000Z',
  dueDate: '2026-10-01T00:00:00.000Z',
  purchaseOrderId: 'po-1',
  purchaseOrderRevisionId: 'rev-1',
  lines: [
    {
      id: 'bl-9',
      lineNumber: 1,
      description: '50kg cement bags',
      quantity: '185.0000',
      unitPrice: '10.0000',
      netAmount: '1850.00',
      vatAmount: '0.00',
      grossAmount: '1850.00',
      expenseProfileCode: 'OFFICE_EXPENSE',
      projectId: 'prj-1',
      boqNodeId: null,
    },
  ],
} as unknown as SupplierBill;

describe('SupplierBillEditPage', () => {
  it('prefills a returned direct bill and saves changes with PATCH, then opens the bill', async () => {
    const user = userEvent.setup();
    const patch = vi.fn((_args, options) => options.onSuccess({ id: 'bill-7' }));
    mocks.useUpdateSupplierBill.mockReturnValue(createState({ mutate: patch }));
    mocks.useSupplierBill.mockReturnValue(loaded(DRAFT_DIRECT));
    renderWithProviders(<SupplierBillEditPage id="bill-7" />);

    expect(screen.getByRole('heading', { name: 'Edit bill BILL-2026-0042' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to bill' })).toHaveAttribute('href', '/finance/accounting/bills/bill-7');
    expect(screen.getByRole('radio', { name: /direct expense/i })).toBeChecked();
    expect(byId('bill-invoice-number')).toHaveValue('INV-77');
    expect(byId('bill-line-0-description')).toHaveValue('Office rent');
    // Untouched: nothing to save yet, said as such.
    expect(screen.queryByText('Not saved yet')).not.toBeInTheDocument();

    const price = byId('bill-line-0-unitPrice');
    await user.clear(price);
    await user.type(price, '5060');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    // PATCH, never a second POST.
    expect(mutate).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch.mock.calls[0]![0]).toEqual({
      id: 'bill-7',
      payload: {
        supplierId: 'sup-2',
        supplierInvoiceNumber: 'INV-77',
        billDate: '2026-09-10',
        dueDate: '2026-10-10',
        currencyCode: 'USD',
        lines: [
          {
            description: 'Office rent',
            quantity: 1,
            unitPrice: 5060,
            netAmount: 5060,
            vatAmount: 0,
            expenseProfileCode: 'OFFICE_EXPENSE',
          },
        ],
      },
    });
    expect(routerMocks.push).toHaveBeenCalledWith('/finance/accounting/bills/bill-7');
  });

  it('shows why a returned bill came back, while it is being corrected', () => {
    mocks.useSupplierBill.mockReturnValue(
      loaded({ ...DRAFT_DIRECT, returnedAt: '2026-09-16T10:00:00Z', returnReason: 'Amount is $5,060, not $5,660.' }),
    );
    renderWithProviders(<SupplierBillEditPage id="bill-7" />);
    expect(screen.getByText('Returned for correction — fix this before submitting again')).toBeInTheDocument();
    expect(screen.getByText('Amount is $5,060, not $5,660.')).toBeInTheDocument();
  });

  it('does not warn that the bill duplicates its own invoice number', () => {
    mocks.useSupplierBill.mockReturnValue(loaded(DRAFT_DIRECT));
    mocks.useSupplierBills.mockReturnValue(loaded([DRAFT_DIRECT]));
    renderWithProviders(<SupplierBillEditPage id="bill-7" />);

    expect(screen.queryByText(/is already recorded on/)).not.toBeInTheDocument();
  });

  it('shows a 409 from PATCH on the invoice-number field', () => {
    mocks.useSupplierBill.mockReturnValue(loaded(DRAFT_DIRECT));
    mocks.useUpdateSupplierBill.mockReturnValue(
      createState({
        isError: true,
        error: new ApiError(409, 'Supplier invoice INV-77 is already recorded on BILL-2026-0050', 'CONFLICT'),
      }),
    );
    renderWithProviders(<SupplierBillEditPage id="bill-7" />);

    expect(byId('bill-invoice-number-error')).toHaveTextContent(
      'Supplier invoice INV-77 is already recorded on BILL-2026-0050',
    );
  });

  it('prefills a PO bill with what each line billed, and PATCHes it', async () => {
    const user = userEvent.setup();
    mocks.useSupplierBill.mockReturnValue(loaded(DRAFT_PO));
    mocks.usePurchaseOrder.mockReturnValue({ data: PO, isPending: false, isError: false });
    mocks.useGoodsReceipts.mockReturnValue(loaded([GRN_POSTED]));
    renderWithProviders(<SupplierBillEditPage id="bill-8" />);

    expect(screen.getByRole('heading', { name: 'Edit bill' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /against a purchase order/i })).toBeChecked();
    await waitFor(() => expect(byId('bill-line-0-quantity')).toHaveValue('185'));
    // Billing what was received: no over-billing note.
    expect(screen.queryByText(/more than received/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]![0]).toEqual({
      id: 'bill-8',
      payload: {
        supplierId: 'sup-1',
        purchaseOrderId: 'po-1',
        supplierInvoiceNumber: 'INV-9044',
        billDate: '2026-09-01',
        dueDate: '2026-10-01',
        currencyCode: 'USD',
        lines: [
          {
            description: '50kg cement bags',
            quantity: 185,
            unitPrice: 10,
            netAmount: 1850,
            vatAmount: 0,
            expenseProfileCode: 'OFFICE_EXPENSE',
          },
        ],
      },
    });
  });

  it.each(['SUBMITTED', 'APPROVED', 'REJECTED'] as const)(
    'refuses to edit a %s bill, with a link back to it',
    (documentStatus) => {
      mocks.useSupplierBill.mockReturnValue(loaded({ ...DRAFT_DIRECT, documentStatus }));
      renderWithProviders(<SupplierBillEditPage id="bill-7" />);

      expect(screen.getByText('Only a draft bill can be edited.')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Back to bill' })).toHaveAttribute(
        'href',
        '/finance/accounting/bills/bill-7',
      );
      expect(byId('bill-invoice-number')).toBeNull();
    },
  );
});
