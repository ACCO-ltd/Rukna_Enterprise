import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import type { GoodsReceipt, MaterialRequest, PurchaseOrder } from '../types';

/**
 * The three procurement lists share the clients-list pattern: one Filter button and chips, one
 * primary, the document number as the row's one link, a kebab holding only permitted commands,
 * a first-use empty state without "Clear filters", and money hidden (never $0) for money-blind
 * roles. Enriched backend fields render when present and fall back to "—" when absent.
 */

const search = vi.hoisted(() => ({ params: new URLSearchParams() }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => search.params,
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/procurement',
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@/features/projects/hooks/use-projects', () => ({
  useProjects: () => ({ data: [{ id: 'p1', code: 'ACCO-HDN-26-0005', name: 'Hodan villa' }] }),
}));

const hooks = vi.hoisted(() => {
  const idle = () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null });
  return {
    useMaterialRequests: vi.fn(),
    usePurchaseOrders: vi.fn(),
    useGoodsReceipts: vi.fn(),
    useSuppliers: vi.fn(() => ({ data: [{ id: 's1', name: 'Bakaal Steel' }] })),
    useCancelMaterialRequest: vi.fn(idle),
    useCancelPurchaseOrder: vi.fn(idle),
    useCancelGoodsReceipt: vi.fn(idle),
  };
});
vi.mock('../hooks/use-procurement', async (original) => ({ ...(await original<object>()), ...hooks }));

import { GrnList } from './grn-screens';
import { MrList } from './mr-list';
import { PoList } from './po-list';

const loaded = <T,>(data: T[]) => ({ data, isPending: false, isError: false, refetch: vi.fn() });
const table = async () => within(await screen.findByRole('table'));

const MONEY = 'view:commitment-ledger';

function mr(overrides: Partial<MaterialRequest> & { id: string }): MaterialRequest {
  return {
    mrNumber: `MR-2026-000${overrides.id}`,
    requestScope: 'PROJECT',
    projectId: 'p1',
    status: 'SUBMITTED',
    approvalInstanceId: null,
    requestedDate: '2026-10-01',
    requiredByDate: null,
    description: null,
    notes: null,
    lines: [],
    ...overrides,
  };
}

function po(overrides: Partial<PurchaseOrder> & { id: string }): PurchaseOrder {
  return {
    poNumber: `PO-2026-000${overrides.id}`,
    status: 'OPEN',
    supplierId: 's1',
    currentRevisionId: 'r1',
    supplier: { id: 's1', name: 'Bakaal Steel' },
    approvalInstanceId: null,
    closedAt: null,
    revisions: [
      {
        id: 'r1',
        revisionNumber: 1,
        status: 'ACTIVE',
        currencyCode: 'USD',
        effectiveFrom: '2026-09-20',
        reason: null,
        deliveryAddress: null,
        expectedDeliveryDate: null,
        approvedAt: null,
        approvedBy: null,
        quotationRef: null,
        quotationDate: null,
        quotedAmount: null,
      },
    ],
    ...overrides,
  };
}

function grn(overrides: Partial<GoodsReceipt> & { id: string }): GoodsReceipt {
  return {
    grnNumber: `GRN-2026-000${overrides.id}`,
    status: 'POSTED',
    purchaseOrderId: 'po1',
    purchaseOrderRevisionId: 'r1',
    supplierId: 's1',
    deliveryDate: '2026-10-02',
    deliveryNoteRef: null,
    postedAt: null,
    postedBy: null,
    lines: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  search.params = new URLSearchParams();
  hooks.usePurchaseOrders.mockReturnValue(loaded([]));
});

describe('MrList', () => {
  it('shows number + title as the one link, who it is for, the need date with Urgent, and the estimate', async () => {
    hooks.useMaterialRequests.mockReturnValue(
      loaded([
        mr({
          id: '1',
          title: 'Rebar for level 2 slab',
          priority: 'URGENT',
          requiredByDate: '2026-10-10',
          requester: { id: 'u1', name: 'Hamza Ali' },
          estimatedTotal: '8500.00',
          moneyVisible: true,
        }),
        mr({ id: '2', requestScope: 'ORGANIZATION', projectId: null, status: 'DRAFT', estimatedTotal: null }),
      ]),
    );
    renderWithProviders(<MrList />, { permissions: [MONEY] });

    const grid = await table();
    const link = grid.getByRole('link', { name: /MR-2026-0001/ });
    expect(link).toHaveAttribute('href', '/procurement/requests/1');
    expect(link).toHaveTextContent('Rebar for level 2 slab');
    expect(grid.getByText('Hodan villa')).toBeInTheDocument();
    expect(grid.getByText('by Hamza Ali')).toBeInTheDocument();
    expect(grid.getByText('Urgent')).toBeInTheDocument();
    expect(grid.getByText('$8,500.00')).toBeInTheDocument();
    // Overhead request: no project, no date, nothing estimated — never $0.
    expect(grid.getByText('ACCO overhead')).toBeInTheDocument();
    expect(grid.getByText('No date')).toBeInTheDocument();
    expect(grid.queryByText('$0.00')).not.toBeInTheDocument();
  });

  it('hides the estimate column for a money-blind role and says so once', async () => {
    hooks.useMaterialRequests.mockReturnValue(
      loaded([mr({ id: '1', estimatedTotal: null, moneyVisible: false })]),
    );
    renderWithProviders(<MrList />, { permissions: ['create:material-request', MONEY] });

    // The server's verdict wins over the permission.
    expect((await table()).queryByRole('columnheader', { name: /Estimate/ })).not.toBeInTheDocument();
    expect(screen.getByText('Estimates are hidden for your role.')).toBeInTheDocument();
  });

  it('sends "Requested for" as requestedFor (a project id or overhead)', async () => {
    hooks.useMaterialRequests.mockReturnValue(loaded([mr({ id: '1' })]));
    search.params = new URLSearchParams('projectId=p1');
    renderWithProviders(<MrList />);
    expect(hooks.useMaterialRequests).toHaveBeenLastCalledWith({ requestedFor: 'p1' });
  });

  it('first use: title, hint and the primary — no Clear filters', async () => {
    hooks.useMaterialRequests.mockReturnValue(loaded([]));
    renderWithProviders(<MrList />, { permissions: ['create:material-request'] });

    expect(await screen.findByText('No material requests yet')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /New request/ }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
  });

  it('filtered to nothing: offers Clear filters instead of the first-use state', async () => {
    hooks.useMaterialRequests.mockReturnValue(loaded([]));
    search.params = new URLSearchParams('projectId=p1');
    renderWithProviders(<MrList />);

    expect((await screen.findAllByText('No requests match these filters')).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Clear filters' }).length).toBeGreaterThan(0);
    expect(screen.queryByText('No material requests yet')).not.toBeInTheDocument();
  });

  it('offers Cancel in the kebab only on a draft, and only to someone who may raise requests', async () => {
    const user = userEvent.setup();
    hooks.useMaterialRequests.mockReturnValue(
      loaded([mr({ id: '1', status: 'DRAFT' }), mr({ id: '2', status: 'APPROVED' })]),
    );
    renderWithProviders(<MrList />, { permissions: ['create:material-request'] });

    await user.click((await table()).getByRole('button', { name: 'Actions for MR-2026-0001' }));
    expect(await screen.findByRole('menuitem', { name: 'Cancel request' })).toBeInTheDocument();
    await user.keyboard('{Escape}');

    await user.click((await table()).getByRole('button', { name: 'Actions for MR-2026-0002' }));
    expect(await screen.findByRole('menuitem', { name: 'Open' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Cancel request' })).not.toBeInTheDocument();
  });
});

describe('PoList', () => {
  it('opens narrowed to the project a workspace linked from, as a chip', async () => {
    search.params = new URLSearchParams('projectId=p1');
    hooks.usePurchaseOrders.mockReturnValue(loaded([po({ id: '1' })]));
    renderWithProviders(<PoList />);

    expect(hooks.usePurchaseOrders).toHaveBeenLastCalledWith({ projectId: 'p1' });
    expect(await screen.findByText('ACCO-HDN-26-0005 · Hodan villa')).toBeInTheDocument();
  });

  it('renders the list read: project (+ more), delivery, total, revision > 1', async () => {
    hooks.usePurchaseOrders.mockReturnValue(
      loaded([
        po({
          id: '1',
          project: { id: 'p1', name: 'Hodan villa' },
          projectCount: 3,
          total: '12500.00',
          currencyCode: 'USD',
          deliveryStatus: 'PARTLY_RECEIVED',
          activeRevisionNumber: 2,
        }),
      ]),
    );
    renderWithProviders(<PoList />, { permissions: [MONEY] });

    const grid = await table();
    const link = grid.getByRole('link', { name: /PO-2026-0001/ });
    expect(link).toHaveTextContent('PO-2026-0001 · revision 2');
    expect(link).toHaveTextContent('Bakaal Steel');
    expect(grid.getByText('Hodan villa')).toBeInTheDocument();
    expect(grid.getByText('+2 more')).toBeInTheDocument();
    expect(grid.getByText('Partly received')).toBeInTheDocument();
    expect(grid.getByText('$12,500.00')).toBeInTheDocument();
    expect(grid.getByText('Open')).toBeInTheDocument();
  });

  it('shows "—" where a row has no project, delivery or total, and no revision at 1', async () => {
    hooks.usePurchaseOrders.mockReturnValue(loaded([po({ id: '1' })]));
    renderWithProviders(<PoList />, { permissions: [MONEY] });

    const grid = await table();
    expect(grid.getByRole('link', { name: /PO-2026-0001/ })).not.toHaveTextContent('revision');
    expect(grid.getAllByText('—').length).toBeGreaterThanOrEqual(3);
    expect(grid.queryByText('$0.00')).not.toBeInTheDocument();
  });

  it("follows the server's moneyVisible verdict over the permission", async () => {
    hooks.usePurchaseOrders.mockReturnValue(loaded([po({ id: '1', total: null, moneyVisible: false })]));
    renderWithProviders(<PoList />, { permissions: [MONEY] });

    expect((await table()).queryByRole('columnheader', { name: /Total/ })).not.toBeInTheDocument();
    expect(screen.getByText('Order totals are hidden for your role.')).toBeInTheDocument();
  });

  it('lists no footnotes about the API under the grid', async () => {
    hooks.usePurchaseOrders.mockReturnValue(loaded([po({ id: '1' })]));
    renderWithProviders(<PoList />, { permissions: [MONEY] });
    await table();
    expect(screen.queryByText(/line data is only available/)).not.toBeInTheDocument();
    expect(screen.queryByText(/most recent one/)).not.toBeInTheDocument();
  });
});

describe('GrnList', () => {
  it('shows receipt + supplier as the one row link, the PO as its own link, and who delivered', async () => {
    hooks.usePurchaseOrders.mockReturnValue(loaded([po({ id: '1' })]));
    hooks.useGoodsReceipts.mockReturnValue(
      loaded([
        grn({
          id: '1',
          purchaseOrderId: '1',
          purchaseOrder: { id: '1', number: 'PO-2026-0001' },
          supplier: { id: 's1', name: 'Bakaal Steel' },
          deliveryNoteRef: 'DN-4410',
          deliveredBy: { id: 'u2', name: 'Omar Site' },
          project: { id: 'p1', name: 'Hodan villa' },
        }),
      ]),
    );
    renderWithProviders(<GrnList />, { permissions: ['create:goods-receipt'] });

    const grid = await table();
    const link = grid.getByRole('link', { name: /GRN-2026-0001/ });
    expect(link).toHaveAttribute('href', '/procurement/grn/1');
    expect(link).toHaveTextContent('Bakaal Steel');
    expect(grid.getByRole('link', { name: 'PO-2026-0001' })).toHaveAttribute('href', '/procurement/orders/1');
    expect(grid.getByText('by Omar Site')).toBeInTheDocument();
    expect(grid.getByText('DN-4410')).toBeInTheDocument();
    expect(grid.getByText('Hodan villa')).toBeInTheDocument();
  });

  it('first use: "No deliveries received yet" with Receive delivery', async () => {
    hooks.useGoodsReceipts.mockReturnValue(loaded([]));
    renderWithProviders(<GrnList />, { permissions: ['create:goods-receipt'] });

    expect(await screen.findByText('No deliveries received yet')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Receive delivery/ }).length).toBeGreaterThan(0);
  });

  it('hides the primary from someone who may not receive', async () => {
    hooks.useGoodsReceipts.mockReturnValue(loaded([grn({ id: '1' })]));
    renderWithProviders(<GrnList />, { permissions: [] });
    await table();
    expect(screen.queryByRole('link', { name: /Receive delivery/ })).not.toBeInTheDocument();
  });
});

describe('server search', () => {
  it('sends what is typed in the search box to the API, debounced', async () => {
    const user = userEvent.setup();
    hooks.usePurchaseOrders.mockReturnValue(loaded([po({ id: '1' })]));
    renderWithProviders(<PoList />, { permissions: [MONEY] });

    await user.type(await screen.findByRole('searchbox'), 'bakaal');
    await waitFor(() => expect(hooks.usePurchaseOrders).toHaveBeenLastCalledWith({ search: 'bakaal' }));
  });
});
