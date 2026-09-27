import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CommercialApplicationsResponse,
  CommercialCurrentCycleResponse,
  CommercialSummaryResponse,
  SeparateChargesResponse,
} from '@erp/types';

import { renderWithProviders } from '@/test/render';
import {
  createSeparateChargeInvoice,
  getCommercialApplications,
  getCommercialCurrentCycle,
  getCommercialSummary,
  getProjectSeparateCharges,
} from '@/features/commercial/api/commercial-api';
import { generateInvoiceFromIpc, listInvoices } from '@/features/accounting/api/invoices-api';
import { listClients } from '@/features/clients/api/clients-api';
import { listProjects } from '@/features/projects/api/projects-api';

import { InvoiceCreate } from './invoice-create';
import { InvoicesList } from './invoices-list';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/finance/accounting/invoices/new',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/features/commercial/api/commercial-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/commercial/api/commercial-api')>()),
  getCommercialSummary: vi.fn(),
  getCommercialApplications: vi.fn(),
  getCommercialCurrentCycle: vi.fn(),
  getProjectSeparateCharges: vi.fn(),
  createSeparateChargeInvoice: vi.fn(),
  issuePackage: vi.fn(),
}));

vi.mock('@/features/accounting/api/invoices-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/accounting/api/invoices-api')>()),
  listInvoices: vi.fn(),
  generateInvoiceFromIpc: vi.fn(),
  generateInvoiceFromInstallment: vi.fn(),
}));

vi.mock('@/features/projects/api/projects-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/projects/api/projects-api')>()),
  listProjects: vi.fn(),
}));

vi.mock('@/features/clients/api/clients-api', () => ({ listClients: vi.fn() }));

const MANAGE = ['manage:receivable', 'view:accounting', 'view:contract'];

function summary(): CommercialSummaryResponse {
  return {
    projectId: 'proj-1',
    currency: 'USD',
    financialsVisible: true,
    mainContract: { id: 'con-1', clientName: 'Ministry of Water Resources' },
  } as unknown as CommercialSummaryResponse;
}

function applications(): CommercialApplicationsResponse {
  const row = {
    ipaId: 'ipa-1',
    applicationNumber: 3,
    applicationRef: 'IPA-003',
    ipcId: 'ipc-1',
    certifiedGross: '12000.00',
    certifiedNet: '11000.00',
    invoiceId: null,
  };
  return {
    projectId: 'proj-1',
    contractId: 'con-1',
    financialsVisible: true,
    applications: [
      row,
      // Already invoiced — must not be offered.
      { ...row, ipaId: 'ipa-2', applicationRef: 'IPA-002', ipcId: 'ipc-2', invoiceId: 'inv-9' },
    ],
  } as unknown as CommercialApplicationsResponse;
}

function cycle(): CommercialCurrentCycleResponse {
  const installment = {
    id: 'inst-1',
    sortOrder: 1,
    name: 'Foundation complete',
    percentage: '0.3000',
    amount: '30000.00',
    status: 'NEXT',
    canPrepareInvoice: true,
    readyToBill: true,
    programmeMilestone: null,
    triggerType: 'MILESTONE',
    dueDate: null,
  };
  return {
    projectId: 'proj-1',
    paymentSchedule: {
      currency: 'USD',
      contractValue: '100000.00',
      totalCollected: '0.00',
      installments: [
        installment,
        // Not ready to bill — the server says it cannot be invoiced yet.
        { ...installment, id: 'inst-2', sortOrder: 2, name: 'Roof slab', status: 'UPCOMING', canPrepareInvoice: false },
      ],
      variationLines: [],
    },
  } as unknown as CommercialCurrentCycleResponse;
}

function charges(): SeparateChargesResponse {
  return {
    projectId: 'proj-1',
    items: [
      {
        source: 'BOQ_LEAF',
        id: 'node-1',
        code: 'SC-01',
        name: 'Site mobilisation',
        unitRate: '9800.00',
        quantity: '1',
        totalAmount: '9800.00',
        currency: 'USD',
        contractId: 'con-1',
        invoice: null,
      },
    ],
  } as SeparateChargesResponse;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listProjects).mockResolvedValue([
    { id: 'proj-1', code: 'ACCO-HDN-26-0001', name: 'Hodan Water Tower', commercialModel: 'CLIENT_CONTRACT' },
  ] as never);
  vi.mocked(getCommercialSummary).mockResolvedValue(summary());
  vi.mocked(getCommercialApplications).mockResolvedValue(applications());
  vi.mocked(getCommercialCurrentCycle).mockResolvedValue(cycle());
  vi.mocked(getProjectSeparateCharges).mockResolvedValue(charges());
});

async function chooseProject(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('combobox', { name: /Project/ }));
  await user.click(await screen.findByRole('option', { name: /Hodan Water Tower/ }));
}

async function openSourcePicker(user: ReturnType<typeof userEvent.setup>, label: RegExp) {
  const trigger = screen.getByRole('combobox', { name: label });
  await waitFor(() => expect(trigger).toBeEnabled());
  await user.click(trigger);
}

describe('InvoiceCreate', () => {
  it('asks what is being invoiced, with no editable lines, discount or client reference', () => {
    renderWithProviders(<InvoiceCreate />, { permissions: MANAGE });

    expect(screen.getByRole('group', { name: /What are you invoicing\?/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Interim payment certificate/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Billing milestone/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Separate charge/ })).toBeInTheDocument();
    expect(screen.getByText('Choose a source to add its line')).toBeInTheDocument();

    expect(screen.queryByText(/discount/i)).toBeNull();
    expect(screen.queryByText(/client reference/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Add a line/ })).toBeNull();
    // The client is derived, never picked.
    expect(screen.getByLabelText('Client')).toHaveAttribute('readonly');
  });

  it('changes the picker with the source kind and lists only billable sources', async () => {
    const user = userEvent.setup();
    renderWithProviders(<InvoiceCreate />, { permissions: MANAGE });

    await user.click(screen.getByRole('radio', { name: /Interim payment certificate/ }));
    await chooseProject(user);
    await openSourcePicker(user, /Payment certificate/);
    expect(await screen.findByRole('option', { name: /IPA-003/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /IPA-002/ })).toBeNull();
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('radio', { name: /Billing milestone/ }));
    await openSourcePicker(user, /^Milestone/);
    expect(await screen.findByRole('option', { name: /Foundation complete/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Roof slab/ })).toBeNull();
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('radio', { name: /Separate charge/ }));
    await openSourcePicker(user, /Separate charge item/);
    expect(await screen.findByRole('option', { name: /Site mobilisation/ })).toBeInTheDocument();
  });

  it('shows the source as one read-only line with its amount, and the derived client', async () => {
    const user = userEvent.setup();
    renderWithProviders(<InvoiceCreate />, { permissions: MANAGE });

    await user.click(screen.getByRole('radio', { name: /Separate charge/ }));
    await chooseProject(user);
    await openSourcePicker(user, /Separate charge item/);
    await user.click(await screen.findByRole('option', { name: /Site mobilisation/ }));

    const lines = screen.getByRole('table', { name: 'Invoice lines' });
    expect(within(lines).getByText('Separate charge — Site mobilisation')).toBeInTheDocument();
    expect(within(lines).getAllByText('$9,800.00').length).toBeGreaterThan(0);
    expect(within(lines).queryByRole('textbox')).toBeNull();
    expect(screen.getByText("Lines come from the source document and can't be edited here.")).toBeInTheDocument();
    expect(screen.getByText('Amount before VAT')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText('Client')).toHaveValue('Ministry of Water Resources'),
    );
  });

  it('saves an IPC draft through POST /invoices/from-ipc and opens it', async () => {
    const user = userEvent.setup();
    vi.mocked(generateInvoiceFromIpc).mockResolvedValue({ id: 'inv-new' } as never);
    renderWithProviders(<InvoiceCreate />, { permissions: MANAGE });

    await user.click(screen.getByRole('radio', { name: /Interim payment certificate/ }));
    await chooseProject(user);
    await openSourcePicker(user, /Payment certificate/);
    await user.click(await screen.findByRole('option', { name: /IPA-003/ }));
    await user.type(screen.getByLabelText('Terms shown on the invoice'), 'Net 30');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(generateInvoiceFromIpc).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(generateInvoiceFromIpc).mock.calls[0]![0];
    expect(payload).toMatchObject({ ipcId: 'ipc-1', paymentTerms: 'Net 30' });
    expect(payload.invoiceDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(payload.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Object.keys(payload).sort()).toEqual(['dueDate', 'invoiceDate', 'ipcId', 'paymentTerms']);
    expect(push).toHaveBeenCalledWith('/finance/accounting/invoices/inv-new');
  });

  it('saves a separate-charge draft through POST /invoices/from-separate-charge', async () => {
    const user = userEvent.setup();
    vi.mocked(createSeparateChargeInvoice).mockResolvedValue({ id: 'inv-sc', postingStatus: 'NOT_POSTED' });
    renderWithProviders(<InvoiceCreate />, { permissions: MANAGE });

    await user.click(screen.getByRole('radio', { name: /Separate charge/ }));
    await chooseProject(user);
    await openSourcePicker(user, /Separate charge item/);
    await user.click(await screen.findByRole('option', { name: /Site mobilisation/ }));
    await user.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(createSeparateChargeInvoice).toHaveBeenCalledTimes(1));
    expect(vi.mocked(createSeparateChargeInvoice).mock.calls[0]![0]).toMatchObject({ boqNodeId: 'node-1' });
    expect(generateInvoiceFromIpc).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith('/finance/accounting/invoices/inv-sc');
  });

  it('routes a milestone through the prepare-invoice (issue package) flow, not a bare draft', async () => {
    const user = userEvent.setup();
    renderWithProviders(<InvoiceCreate />, { permissions: MANAGE });

    await user.click(screen.getByRole('radio', { name: /Billing milestone/ }));
    expect(screen.getByRole('button', { name: 'Prepare invoice' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save draft' })).toBeNull();

    await chooseProject(user);
    await openSourcePicker(user, /^Milestone/);
    await user.click(await screen.findByRole('option', { name: /Foundation complete/ }));
    await user.click(screen.getByRole('button', { name: 'Prepare invoice' }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(generateInvoiceFromIpc).not.toHaveBeenCalled();
  });

  it('blocks saving and names every missing field', async () => {
    const user = userEvent.setup();
    renderWithProviders(<InvoiceCreate />, { permissions: MANAGE });

    await user.click(screen.getByRole('button', { name: 'Save draft' }));

    expect(await screen.findByText(/Fix 3 fields before saving/)).toBeInTheDocument();
    expect(generateInvoiceFromIpc).not.toHaveBeenCalled();
  });

  it('shows a restricted state without manage:receivable', () => {
    renderWithProviders(<InvoiceCreate />, { permissions: ['view:accounting'] });

    expect(screen.getByText("You can't raise client invoices")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save draft' })).toBeNull();
  });
});

describe('InvoicesList — New invoice action', () => {
  beforeEach(() => {
    vi.mocked(listClients).mockResolvedValue([]);
  });

  it('offers New invoice to a holder of manage:receivable, in the empty state too', async () => {
    vi.mocked(listInvoices).mockResolvedValue([]);
    renderWithProviders(<InvoicesList />, { withToast: true, permissions: MANAGE });

    await screen.findByText('No client invoices yet');
    const links = screen.getAllByRole('link', { name: 'New invoice' });
    expect(links.length).toBeGreaterThanOrEqual(1);
    for (const link of links) expect(link).toHaveAttribute('href', '/finance/accounting/invoices/new');
  });

  it('hides New invoice without manage:receivable', async () => {
    vi.mocked(listInvoices).mockResolvedValue([]);
    renderWithProviders(<InvoicesList />, { withToast: true, permissions: ['view:accounting'] });

    await screen.findByText('No client invoices yet');
    expect(screen.queryByRole('link', { name: 'New invoice' })).toBeNull();
  });
});
