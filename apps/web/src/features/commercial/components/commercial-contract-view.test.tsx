import { fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { stageFixture, workspaceFixture } from '../test-fixtures';
import { CommercialContractView, PaymentSchedulePanel, installmentDisplayState } from './commercial-contract-view';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const schedule = vi.hoisted(() => ({ installments: [] as unknown[] }));
vi.mock('../hooks/use-commercial', () => ({
  useCommercialCurrentCycle: () => ({
    isPending: false,
    isError: false,
    data: {
      paymentSchedule: { currency: 'USD', contractValue: '412500.00', totalCollected: '173250.00', installments: schedule.installments, variationLines: [] },
    },
  }),
  useCommercialSummary: () => ({ isPending: true, data: undefined }),
}));
const readiness = vi.hoisted(() => ({ mark: vi.fn(), undo: vi.fn() }));
vi.mock('../hooks/use-mark-ready-to-bill', async (importActual) => ({
  ...(await importActual<typeof import('../hooks/use-mark-ready-to-bill')>()),
  useMarkReadyToBill: () => ({ mutate: readiness.mark, isPending: false, error: null }),
  useRevokeReadyToBill: () => ({ mutate: readiness.undo, isPending: false, error: null }),
}));
vi.mock('./contract-changes-panel', () => ({ ContractChangesPanel: () => null }));
vi.mock('./payment-schedule-tab', () => ({
  ScheduleForm: () => <div>editor</div>,
  splitScheduleForEditing: () => ({ frozen: [], editable: [] }),
}));
vi.mock('./record-signed-date-dialog', () => ({ RecordSignedDateDialog: () => <div role="dialog">signed date</div> }));

beforeEach(() => {
  readiness.mark.mockReset();
  readiness.undo.mockReset();
  schedule.installments = [
    stageFixture({ id: 's1', sortOrder: 0, name: 'Advance (mobilisation)', percentage: '0.4000', amount: '165000.00', triggerType: 'ADVANCE', status: 'PAID', releasedBy: { kind: 'ADVANCE' }, invoiceId: 'inv-121', invoiceState: 'ISSUED', collectionStatus: 'PAID' }),
    stageFixture({ id: 's2', sortOrder: 1, name: 'Substructure complete', status: 'NEXT', releasedBy: { kind: 'MILESTONE', milestoneId: 'm1', milestoneCode: 'MS-01', milestoneName: 'Substructure complete', verifiedAt: '2026-09-26' }, collectionStatus: 'READY_TO_BILL' }),
    stageFixture({ id: 's3', sortOrder: 2, name: 'Frame complete', percentage: '0.2000', amount: '82500.00', billingBlocker: 'MILESTONE_NOT_VERIFIED', releasedBy: { kind: 'MILESTONE', milestoneId: 'm2', milestoneCode: 'MS-02', milestoneName: 'Frame complete', verifiedAt: null } }),
    stageFixture({ id: 's4', sortOrder: 3, name: 'Practical completion', percentage: '0.1000', amount: '41250.00', billingBlocker: 'MILESTONE_NOT_LINKED' }),
  ];
});

function scheduleRows() {
  const section = screen.getByRole('heading', { name: 'Payment schedule' }).closest('section')!;
  return within(within(section).getByRole('table')).getAllByRole('row').slice(1);
}

describe('Contract view — facts', () => {
  it('states what was signed, including the scope and the agreement', () => {
    renderWithProviders(<CommercialContractView projectId="p1" workspace={workspaceFixture()} />);
    expect(screen.getByRole('link', { name: 'Hayat Market' })).toHaveAttribute('href', '/clients/c1');
    expect(screen.getByText('Milestone payments · Net 30')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'BOQ version 1 · signed copy' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hayat-Market-contract.pdf' })).toBeInTheDocument();
  });

  it('shows a missing signed date as "Not recorded" with Add, for a contract activated before it was required', () => {
    const base = workspaceFixture();
    renderWithProviders(
      <CommercialContractView projectId="p1" workspace={{ ...base, contract: { ...base.contract!, signedDate: null } }} />,
    );
    expect(screen.getByText('Not recorded')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
  });

  it('hides the value from a money-blind reader rather than showing $0', () => {
    renderWithProviders(<CommercialContractView projectId="p1" workspace={workspaceFixture({ financialsVisible: false })} />);
    expect(screen.getAllByText('Hidden for your role').length).toBeGreaterThan(0);
    expect(screen.queryByText(/\$0/)).not.toBeInTheDocument();
  });
});

describe('Contract view — payment schedule', () => {
  it('says what bills each stage and why it waits, straight from the read model', () => {
    renderWithProviders(<CommercialContractView projectId="p1" workspace={workspaceFixture()} />, {
      permissions: ['manage:project'],
    });
    const rows = scheduleRows();
    expect(within(rows[0]!).getByText('Advance · billable while the contract is active')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('Paid')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Ready to bill')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('MS-01 verified in Progress on Sep 26, 2026')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Not ready')).toBeInTheDocument();
    expect(within(rows[2]!).getByRole('link', { name: 'Waits for MS-02 to be verified' })).toHaveAttribute('href', '/projects/p1/progress/review');
    expect(within(rows[3]!).getByText('Milestone · not linked yet')).toBeInTheDocument();
    expect(within(rows[3]!).getByRole('link', { name: 'Link it to a milestone in Progress › Plan & setup' })).toBeInTheDocument();
    expect(within(rows[0]!).getByText('40%')).toBeInTheDocument();
  });

  it('shows the server’s blocking reason with its owner, and the billing steps (ADR-043 Phase 2)', () => {
    schedule.installments[2] = stageFixture({
      id: 's3',
      sortOrder: 2,
      name: 'Frame complete',
      billingBlocker: 'MILESTONE_NOT_VERIFIED',
      releasedBy: { kind: 'MILESTONE', milestoneId: 'm2', milestoneCode: 'MS-02', milestoneName: 'Frame complete', verifiedAt: null },
      billingEligibility: {
        installmentId: 's3',
        canPrepare: false,
        canIssue: false,
        blockedReason: 'MILESTONE_NOT_VERIFIED',
        steps: [
          { key: 'CONTRACT_ACTIVE', status: 'DONE', owner: 'FINANCE', code: null, detail: null },
          { key: 'MILESTONE_LINKED', status: 'DONE', owner: 'CONSTRUCTION', code: null, detail: null },
          { key: 'MILESTONE_VERIFIED', status: 'BLOCKED', owner: 'CONSTRUCTION', code: 'MILESTONE_NOT_VERIFIED', detail: null },
          { key: 'INVOICE_PREPARED', status: 'PENDING', owner: 'FINANCE', code: 'NOT_PREPARED', detail: null },
        ],
      },
    });
    renderWithProviders(<CommercialContractView projectId="p1" workspace={workspaceFixture()} />);
    const rows = scheduleRows();
    expect(within(rows[2]!).getByText('Progress not verified yet — owner: Construction')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Billing steps (2 of 4 done)')).toBeInTheDocument();
    const steps = within(rows[2]!).getByRole('list', { name: 'Steps', hidden: true });
    expect(within(steps).getAllByRole('listitem', { hidden: true }).map((li) => li.getAttribute('data-status'))).toEqual([
      'DONE',
      'DONE',
      'BLOCKED',
      'PENDING',
    ]);
    // A stage the server says can move carries no blocking note.
    expect(within(rows[1]!).queryByText(/— owner:/)).toBeNull();
  });

  it('offers Re-profile only to someone allowed to', () => {
    renderWithProviders(
      <CommercialContractView
        projectId="p1"
        workspace={workspaceFixture({ capabilities: { ...workspaceFixture().capabilities, canReprofileSchedule: false } })}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Schedule actions' })).not.toBeInTheDocument();
  });
});

describe('Contract view — money-free billing status (ADR-043 Phase 3)', () => {
  const statuses = [
    ['NOT_READY', 'Not ready'],
    ['VERIFIED', 'Verified — awaiting ready to bill'],
    ['READY_TO_BILL', 'Ready to bill'],
    ['BILLED', 'Billed'],
    ['PART_PAID', 'Part paid'],
    ['PAID', 'Paid'],
    ['OVERDUE', 'Overdue'],
  ] as const;

  it('words every server status, with no amount for a money-blind reader', () => {
    schedule.installments = statuses.map(([status], index) =>
      stageFixture({ id: `x${index}`, sortOrder: index, name: `Stage ${index}`, amount: null, amountPaid: null, collectionStatus: status }),
    );
    renderWithProviders(<CommercialContractView projectId="p1" workspace={workspaceFixture({ financialsVisible: false })} />, {
      permissions: ['view:contract'],
    });
    const rows = scheduleRows();
    statuses.forEach(([, label], index) => expect(within(rows[index]!).getByText(label)).toBeInTheDocument());
    expect(screen.getByRole('columnheader', { name: 'Billing status' })).toBeInTheDocument();
    expect(screen.queryByText(/\$\d/)).not.toBeInTheDocument();
  });

  it('offers no billing command, invoice link or Finance link to a construction reader', () => {
    renderWithProviders(<CommercialContractView projectId="p1" workspace={workspaceFixture()} />, {
      permissions: ['view:contract', 'manage:project'],
    });
    expect(screen.queryByRole('link', { name: 'Open in Finance' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'View invoice' })).not.toBeInTheDocument();
    for (const name of [/Prepare/, /Issue/, /Record payment/, /Send/, /reminder/i]) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(screen.getByText('Invoices, payments and reminders are handled by Finance.')).toBeInTheDocument();
  });

  it('gives a finance reader "Open in Finance" and the invoice in Finance', () => {
    renderWithProviders(<CommercialContractView projectId="p1" workspace={workspaceFixture()} />, {
      permissions: ['view:contract', 'view:financial-position'],
    });
    expect(screen.getByRole('link', { name: 'Open in Finance' })).toHaveAttribute('href', '/finance/projects/p1/billing');
    const invoiceLinks = screen.getAllByRole('link', { name: 'View invoice' });
    expect(invoiceLinks.length).toBeGreaterThan(0);
    for (const link of invoiceLinks) expect(link).toHaveAttribute('href', '/finance/projects/p1/billing/invoices/inv-121');
  });

  it('keeps the billing-pipeline words in Finance (mode="finance")', () => {
    renderWithProviders(<PaymentSchedulePanel projectId="p1" workspace={workspaceFixture()} mode="finance" />, {
      permissions: ['view:financial-position'],
    });
    const rows = scheduleRows();
    expect(within(rows[1]!).getByText('Ready to bill')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('Paid')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Upcoming')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open in Finance' })).not.toBeInTheDocument();
  });
});

const TODAY = '2026-09-28';

describe('installmentDisplayState', () => {
  it('maps the backend statuses and the blocker to one display word', () => {
    expect(installmentDisplayState(stageFixture({ id: 'a', status: 'NEXT' }), TODAY)).toBe('READY');
    expect(installmentDisplayState(stageFixture({ id: 'b', status: 'NEXT', billingBlocker: 'MILESTONE_NOT_VERIFIED' }), TODAY)).toBe('UPCOMING');
    expect(installmentDisplayState(stageFixture({ id: 'c', status: 'BILLED', invoiceState: 'DRAFT' }), TODAY)).toBe('DRAFT');
    expect(installmentDisplayState(stageFixture({ id: 'd', status: 'BILLED', invoiceState: 'ISSUED' }), TODAY)).toBe('BILLED');
    expect(installmentDisplayState(stageFixture({ id: 'e', status: 'PARTIALLY_PAID' }), TODAY)).toBe('PARTIALLY_PAID');
    // A Date stage is Upcoming until its date (server day), then Ready.
    const dated = { triggerType: 'TIME_BASED' as const, status: 'NEXT' as const };
    expect(installmentDisplayState(stageFixture({ id: 'f', ...dated, expectedDate: '2026-12-01' }), TODAY)).toBe('UPCOMING');
    expect(installmentDisplayState(stageFixture({ id: 'g', ...dated, expectedDate: '2026-09-28' }), TODAY)).toBe('READY');
  });
});

describe('Mark ready to bill (ADR-043 decision 1)', () => {
  const eligible = (id: string) => ({ installmentId: id, canPrepare: true, canIssue: false, blockedReason: null, steps: [] });
  const notVerified = (id: string) => ({
    installmentId: id,
    canPrepare: false,
    canIssue: false,
    blockedReason: 'MILESTONE_NOT_VERIFIED' as const,
    steps: [{ key: 'MILESTONE_VERIFIED' as const, status: 'BLOCKED' as const, owner: 'CONSTRUCTION' as const, code: 'MILESTONE_NOT_VERIFIED', detail: null }],
  });

  beforeEach(() => {
    schedule.installments = [
      stageFixture({ id: 'paid', sortOrder: 0, name: 'Advance', status: 'PAID', invoiceId: 'inv-1', invoiceState: 'ISSUED', collectionStatus: 'PAID' }),
      stageFixture({ id: 'ok', sortOrder: 1, name: 'Substructure', status: 'NEXT', collectionStatus: 'VERIFIED', billingEligibility: eligible('ok') }),
      stageFixture({ id: 'wait', sortOrder: 2, name: 'Frame', billingBlocker: 'MILESTONE_NOT_VERIFIED', billingEligibility: notVerified('wait') }),
      stageFixture({ id: 'ready', sortOrder: 3, name: 'Roof', status: 'NEXT', readyToBill: true, readyToBillAt: '2026-10-01T00:00:00Z', collectionStatus: 'READY_TO_BILL', billingEligibility: eligible('ready') }),
      stageFixture({ id: 'draft', sortOrder: 4, name: 'Finishes', status: 'BILLED', readyToBill: true, invoiceId: 'inv-2', invoiceState: 'DRAFT', collectionStatus: 'READY_TO_BILL' }),
    ];
  });

  const CD = ['view:contract', 'manage:project', 'mark-ready:billing'];

  it('gives the Construction Director "Mark ready to bill" on an eligible stage and sends it', () => {
    renderWithProviders(<CommercialContractView projectId="p1" workspace={workspaceFixture()} />, { permissions: CD });
    const rows = scheduleRows();
    const button = within(rows[1]!).getByRole('button', { name: 'Mark ready to bill' });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(readiness.mark).toHaveBeenCalledWith({ installmentId: 'ok' });
  });

  it('disables it with the reason in plain words when the milestone is not verified', () => {
    renderWithProviders(<CommercialContractView projectId="p1" workspace={workspaceFixture()} />, { permissions: CD });
    const button = within(scheduleRows()[2]!).getByRole('button', { name: 'Mark ready to bill' });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription("Can't mark ready yet: Progress not verified yet");
  });

  it('offers "Undo ready" on a ready stage, and nothing once Finance has prepared or billed it', () => {
    renderWithProviders(<CommercialContractView projectId="p1" workspace={workspaceFixture()} />, { permissions: CD });
    const rows = scheduleRows();
    fireEvent.click(within(rows[3]!).getByRole('button', { name: 'Undo ready' }));
    expect(readiness.undo).toHaveBeenCalledWith({ installmentId: 'ready' });
    expect(within(rows[3]!).queryByRole('button', { name: 'Mark ready to bill' })).toBeNull();
    for (const row of [rows[0]!, rows[4]!]) {
      expect(within(row).queryByRole('button', { name: /ready/i })).toBeNull();
    }
  });

  it('still offers it after a cancelled invoice (invoice id kept, no live invoice)', () => {
    schedule.installments = [
      stageFixture({ id: 'cx', sortOrder: 0, name: 'Re-bill', status: 'NEXT', invoiceId: 'inv-cancelled', invoiceState: null, collectionStatus: 'VERIFIED', billingEligibility: eligible('cx') }),
    ];
    renderWithProviders(<CommercialContractView projectId="p1" workspace={workspaceFixture()} />, { permissions: CD });
    expect(within(scheduleRows()[0]!).getByRole('button', { name: 'Mark ready to bill' })).toBeEnabled();
  });

  it('keeps it for the finance set (view:contract + manage:receivable)', () => {
    renderWithProviders(<CommercialContractView projectId="p1" workspace={workspaceFixture()} />, {
      permissions: ['view:contract', 'manage:receivable'],
    });
    expect(within(scheduleRows()[1]!).getByRole('button', { name: 'Mark ready to bill' })).toBeEnabled();
  });

  it.each([
    ['Project Manager', ['view:project', 'manage:project']],
    ['contract reader without the permission', ['view:contract', 'manage:project']],
    ['mark-ready:billing without view:contract', ['mark-ready:billing']],
  ])('shows no readiness button to a %s', (_label, permissions) => {
    renderWithProviders(<CommercialContractView projectId="p1" workspace={workspaceFixture()} />, { permissions });
    expect(screen.queryByRole('button', { name: /Mark ready to bill|Undo ready/ })).toBeNull();
  });

  it('is not offered in Finance’s own schedule (mode="finance")', () => {
    renderWithProviders(<PaymentSchedulePanel projectId="p1" workspace={workspaceFixture()} mode="finance" />, {
      permissions: [...CD, 'manage:receivable', 'view:financial-position'],
    });
    expect(screen.queryByRole('button', { name: /Mark ready to bill|Undo ready/ })).toBeNull();
  });
});
