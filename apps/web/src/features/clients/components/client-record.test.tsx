import { ClientStatus } from '@erp/types';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import {
  addClientContact,
  deactivateClient,
  getClient,
  getClientActivity,
  getClientOverview,
  makeClientContactPrimary,
  removeClientContact,
} from '../api/clients-api';
import type { ClientDetail, ClientOverview } from '../types';
import { ClientRecord } from './client-record';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('../api/clients-api', () => ({
  getClient: vi.fn(),
  getClientOverview: vi.fn(),
  getClientActivity: vi.fn(),
  deactivateClient: vi.fn(),
  reactivateClient: vi.fn(),
  addClientContact: vi.fn(),
  updateClientContact: vi.fn(),
  makeClientContactPrimary: vi.fn(),
  removeClientContact: vi.fn(),
}));

const MANAGER = ['manage:client', 'create:project', 'view:financial-position', 'manage:receivable'];

function makeClient(overrides: Partial<ClientDetail> = {}): ClientDetail {
  return {
    id: 'c1',
    organizationId: 'o1',
    code: 'CLI-000001',
    name: 'Hayat Market',
    type: 'COMPANY',
    taxNumber: null,
    defaultCurrency: 'USD',
    status: ClientStatus.ACTIVE,
    createdAt: '2026-03-04T00:00:00Z',
    updatedAt: '2026-03-04T00:00:00Z',
    registrationNumber: 'BL-2201',
    paymentTermsDays: 30,
    countryCode: 'SO',
    city: 'Mogadishu',
    address: 'KM4',
    invoiceEmail: null,
    notes: null,
    allowedCommands: ['DEACTIVATE'],
    deactivationBlockedBy: null,
    contacts: [
      {
        id: 'k1',
        clientId: 'c1',
        name: 'Amina Ali',
        role: 'Owner',
        email: 'amina@hayat.so',
        phone: '+252612345678',
        whatsappPhone: '+252612345678',
        isPrimary: true,
        createdAt: '2026-03-04T00:00:00Z',
      },
      {
        id: 'k2',
        clientId: 'c1',
        name: 'Yusuf Omar',
        role: null,
        email: null,
        phone: '+252616666666',
        whatsappPhone: null,
        isPrimary: false,
        createdAt: '2026-03-05T00:00:00Z',
      },
    ],
    ...overrides,
  };
}

function makeOverview(overrides: Partial<ClientOverview> = {}): ClientOverview {
  return {
    moneyVisible: true,
    metrics: {
      activeProjectCount: 2,
      totalProjectCount: 3,
      activeContractValue: '500000.00',
      outstanding: '42000.00',
      unpaidInvoiceCount: 2,
      overdue: '12000.00',
      overdueDays: 32,
      oldestOverdueInvoice: { id: 'i1', invoiceNumber: 'INV-0042' },
      unappliedCredit: '0.00',
    },
    projects: [
      {
        id: 'p1',
        code: 'ACC-HDN-26-0001',
        name: 'Hayat Tower',
        status: 'ACTIVE',
        contractValue: '500000.00',
        outstanding: '42000.00',
      },
      {
        id: 'p2',
        code: 'ACC-HDN-25-0009',
        name: 'Old Shop',
        status: 'CLOSED',
        contractValue: '80000.00',
        outstanding: null,
      },
    ],
    unpaidInvoices: [
      {
        id: 'i1',
        invoiceNumber: 'INV-0042',
        projectId: 'p1',
        projectName: 'Hayat Tower',
        dueDate: '2026-08-31',
        balance: '12000.00',
        collectionStatus: 'OVERDUE',
      },
      {
        id: 'i2',
        invoiceNumber: 'INV-0051',
        projectId: 'p1',
        projectName: 'Hayat Tower',
        dueDate: '2026-10-30',
        balance: '30000.00',
        collectionStatus: 'CURRENT',
      },
    ],
    ...overrides,
  };
}

const moneyBlindOverview = (): ClientOverview =>
  makeOverview({
    moneyVisible: false,
    metrics: null,
    unpaidInvoices: null,
    projects: makeOverview().projects.map((p) => ({
      ...p,
      contractValue: null,
      outstanding: null,
    })),
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getClient).mockResolvedValue(makeClient());
  vi.mocked(getClientOverview).mockResolvedValue(makeOverview());
  vi.mocked(getClientActivity).mockResolvedValue([
    {
      id: 'a1',
      at: '2026-09-30T09:12:00Z',
      actorName: 'Abdi Yusuf',
      action: 'client.update',
      summary: 'updated the payment terms',
    },
  ]);
});

/** A record panel, found by its heading (RecordPanel is a titled <section>). */
function panel(name: string) {
  const heading = screen.getByRole('heading', { level: 2, name });
  return within(heading.closest('section') as HTMLElement);
}

function queryPanel(name: string) {
  return screen.queryByRole('heading', { level: 2, name });
}

async function renderRecord(permissions = MANAGER) {
  renderWithProviders(<ClientRecord clientId="c1" />, { permissions, withToast: true });
  await screen.findByRole('heading', { level: 1, name: 'Hayat Market' });
}

describe('ClientRecord — header', () => {
  it('shows breadcrumbs, status, code · type · city and "New project" prefilled with the client', async () => {
    await renderRecord();
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByRole('link', { name: 'Projects' })).toHaveAttribute(
      'href',
      '/projects',
    );
    expect(within(crumbs).getByRole('link', { name: 'Clients' })).toHaveAttribute(
      'href',
      '/clients',
    );
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0);
    expect(screen.getByText('CLI-000001')).toBeInTheDocument();
    expect(screen.getByText('Company')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New project' })).toHaveAttribute(
      'href',
      '/projects/new?clientId=c1',
    );
    // One page: no Overview/Projects tabs and no "Back to clients".
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.queryByText('Back to clients')).not.toBeInTheDocument();
  });

  it('puts Edit and the allowed command in the kebab, and deactivates with a reason', async () => {
    vi.mocked(deactivateClient).mockResolvedValue(makeClient({ status: ClientStatus.INACTIVE }));
    const user = userEvent.setup();
    await renderRecord();
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.getByRole('menuitem', { name: 'Edit client' })).toHaveAttribute(
      'href',
      '/clients/c1/edit',
    );
    expect(screen.queryByRole('menuitem', { name: 'Reactivate' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: 'Deactivate client…' }));

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Deactivate client' }));
    expect(await within(dialog).findByText('Enter a reason')).toBeInTheDocument();
    await user.type(within(dialog).getByRole('textbox', { name: 'Reason' }), 'Contract ended');
    await user.click(within(dialog).getByRole('button', { name: 'Deactivate client' }));
    await waitFor(() => expect(deactivateClient).toHaveBeenCalledWith('c1', 'Contract ended'));
  });

  it('explains a blocked deactivation in words instead of offering it', async () => {
    vi.mocked(getClient).mockResolvedValue(
      makeClient({ allowedCommands: [], deactivationBlockedBy: 'ACTIVE_PROJECTS' }),
    );
    const user = userEvent.setup();
    await renderRecord();
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.queryByRole('menuitem', { name: /Deactivate/ })).not.toBeInTheDocument();
    expect(screen.getByText('Can’t deactivate this client yet')).toBeInTheDocument();
    expect(
      screen.getByText('It still has active projects. Close or cancel them first.'),
    ).toBeInTheDocument();
  });

  it('offers Reactivate for an inactive client, and no new project', async () => {
    vi.mocked(getClient).mockResolvedValue(
      makeClient({ status: ClientStatus.INACTIVE, allowedCommands: ['REACTIVATE'] }),
    );
    const user = userEvent.setup();
    await renderRecord();
    expect(screen.queryByRole('link', { name: 'New project' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.getByRole('menuitem', { name: 'Reactivate' })).toBeInTheDocument();
  });

  it('hides actions the reader cannot take', async () => {
    vi.mocked(getClient).mockResolvedValue(makeClient({ allowedCommands: [] }));
    await renderRecord([]);
    expect(screen.queryByRole('link', { name: 'New project' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'More actions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add contact' })).not.toBeInTheDocument();
  });
});

describe('ClientRecord — strip, panels and rail', () => {
  it('shows the metric strip, projects with money, unpaid invoices and the details rail', async () => {
    await renderRecord();
    const summary = await screen.findByLabelText('Client summary');
    expect(within(summary).getByText('2 active')).toBeInTheDocument();
    expect(within(summary).getByText('3 in total')).toBeInTheDocument();
    expect(within(summary).getByText('$500,000.00')).toBeInTheDocument();
    expect(within(summary).getByText('2 unpaid invoices')).toBeInTheDocument();
    expect(within(summary).getByText('32 days · INV-0042')).toHaveClass('text-danger');

    const projects = panel('Projects');
    expect(projects.getByRole('link', { name: 'Hayat Tower' })).toHaveAttribute(
      'href',
      '/projects/p1',
    );
    expect(projects.getByText('ACC-HDN-26-0001')).toBeInTheDocument();
    expect(projects.getByRole('columnheader', { name: 'Contract value' })).toBeInTheDocument();
    expect(projects.getByText('—')).toBeInTheDocument();

    const invoices = panel('Unpaid invoices');
    expect(invoices.getByRole('link', { name: 'All invoices' })).toHaveAttribute(
      'href',
      '/finance/accounting/invoices?clientId=c1',
    );
    expect(invoices.getByRole('link', { name: 'INV-0042' })).toHaveAttribute(
      'href',
      '/finance/accounting/invoices/i1',
    );
    expect(invoices.getByText('Overdue')).toBeInTheDocument();

    const details = panel('Details');
    expect(details.getByText('BL-2201')).toBeInTheDocument();
    expect(details.getByText('Net 30')).toBeInTheDocument();
    expect(details.getByText('KM4, Mogadishu, Somalia')).toBeInTheDocument();
    expect(details.getAllByText('Not recorded')).toHaveLength(2); // Tax ID, invoice email
    expect(details.getByRole('link', { name: 'Edit' })).toHaveAttribute('href', '/clients/c1/edit');

    expect(await screen.findByText('updated the payment terms')).toBeInTheDocument();
  });

  it('hides "All invoices" without manage:receivable', async () => {
    await renderRecord(['view:financial-position']);
    await screen.findByRole('heading', { level: 2, name: 'Unpaid invoices' });
    const invoices = panel('Unpaid invoices');
    expect(invoices.queryByRole('link', { name: 'All invoices' })).not.toBeInTheDocument();
  });

  it('shows money-blind roles no strip, no money columns and no unpaid invoices — with one note', async () => {
    vi.mocked(getClientOverview).mockResolvedValue(moneyBlindOverview());
    await renderRecord(['manage:client']);
    await screen.findByText('Contract values and balances are not shown for your role.');
    const projects = panel('Projects');
    expect(screen.queryByLabelText('Client summary')).not.toBeInTheDocument();
    expect(
      projects.queryByRole('columnheader', { name: 'Contract value' }),
    ).not.toBeInTheDocument();
    expect(projects.queryByRole('columnheader', { name: 'Outstanding' })).not.toBeInTheDocument();
    expect(
      projects.getByText('Contract values and balances are not shown for your role.'),
    ).toBeInTheDocument();
    expect(queryPanel('Unpaid invoices')).not.toBeInTheDocument();
    expect(screen.queryByText(/\$0\.00/)).not.toBeInTheDocument();
  });

  it('replaces strip and tables with one empty state when the client has no projects', async () => {
    vi.mocked(getClientOverview).mockResolvedValue(
      makeOverview({ metrics: null, projects: [], unpaidInvoices: [] }),
    );
    await renderRecord();
    expect(await screen.findByText('No projects for Hayat Market yet')).toBeInTheDocument();
    expect(screen.queryByLabelText('Client summary')).not.toBeInTheDocument();
    expect(queryPanel('Projects')).not.toBeInTheDocument();
    expect(queryPanel('Unpaid invoices')).not.toBeInTheDocument();
  });

  it('still shows a debt on no project (e.g. a migrated opening balance) when there are no projects', async () => {
    const base = makeOverview({});
    vi.mocked(getClientOverview).mockResolvedValue(
      makeOverview({
        projects: [],
        unpaidInvoices: [{ ...base.unpaidInvoices![0]!, projectId: null, projectName: null }],
      }),
    );
    await renderRecord();
    expect(await screen.findByText('No projects for Hayat Market yet')).toBeInTheDocument();
    expect(queryPanel('Unpaid invoices')).toBeInTheDocument();
    expect(screen.getByLabelText('Client summary')).toBeInTheDocument();
  });
});

describe('ClientRecord — contacts', () => {
  it('lists contacts with tel, mailto and WhatsApp links; the primary has no Remove', async () => {
    const user = userEvent.setup();
    await renderRecord();
    const contacts = panel('Contacts · 2');
    expect(contacts.getByRole('link', { name: '+252 61 234 5678' })).toHaveAttribute(
      'href',
      'tel:+252612345678',
    );
    expect(contacts.getByRole('link', { name: 'amina@hayat.so' })).toHaveAttribute(
      'href',
      'mailto:amina@hayat.so',
    );
    expect(contacts.getByRole('link', { name: 'WhatsApp Amina Ali' })).toHaveAttribute(
      'href',
      'https://wa.me/252612345678',
    );
    expect(contacts.queryByRole('link', { name: 'WhatsApp Yusuf Omar' })).not.toBeInTheDocument();

    await user.click(contacts.getByRole('button', { name: 'Actions for Amina Ali' }));
    let menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: 'Make primary' })).not.toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: /Remove/ })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');

    await user.click(contacts.getByRole('button', { name: 'Actions for Yusuf Omar' }));
    menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Make primary' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Remove…' })).toBeInTheDocument();
  });

  it('makes a contact primary', async () => {
    vi.mocked(makeClientContactPrimary).mockResolvedValue(makeClient().contacts[1]!);
    const user = userEvent.setup();
    await renderRecord();
    await user.click(screen.getByRole('button', { name: 'Actions for Yusuf Omar' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Make primary' }));
    await waitFor(() => expect(makeClientContactPrimary).toHaveBeenCalledWith('c1', 'k2'));
  });

  it('removes a contact after a danger confirmation', async () => {
    vi.mocked(removeClientContact).mockResolvedValue(undefined);
    const user = userEvent.setup();
    await renderRecord();
    await user.click(screen.getByRole('button', { name: 'Actions for Yusuf Omar' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Remove…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Remove Yusuf Omar?' });
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(removeClientContact).toHaveBeenCalledWith('c1', 'k2'));
  });

  it('adds a contact in a dialog, sending the phone as E.164 and WhatsApp the same number', async () => {
    vi.mocked(addClientContact).mockResolvedValue({
      ...makeClient().contacts[1]!,
      id: 'k3',
      name: 'Faisal',
    });
    const user = userEvent.setup();
    await renderRecord();
    await user.click(screen.getByRole('button', { name: 'Add contact' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add contact' });
    await user.click(within(dialog).getByRole('button', { name: 'Add contact' }));
    expect(await within(dialog).findByText('Enter a phone number')).toBeInTheDocument();

    await user.type(within(dialog).getByRole('textbox', { name: /^Name/ }), 'Faisal');
    await user.type(within(dialog).getByRole('textbox', { name: /^Phone/ }), '61 777 8888');
    await user.click(within(dialog).getByRole('button', { name: 'Add contact' }));
    await waitFor(() =>
      expect(addClientContact).toHaveBeenCalledWith('c1', {
        name: 'Faisal',
        phone: '+252617778888',
        whatsappPhone: '+252617778888',
      }),
    );
  });
});
