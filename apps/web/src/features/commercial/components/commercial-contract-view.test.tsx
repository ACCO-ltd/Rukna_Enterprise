import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { stageFixture, workspaceFixture } from '../test-fixtures';
import { CommercialContractView, installmentDisplayState } from './commercial-contract-view';

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
vi.mock('./contract-changes-panel', () => ({ ContractChangesPanel: () => null }));
vi.mock('./payment-schedule-tab', () => ({
  ScheduleForm: () => <div>editor</div>,
  splitScheduleForEditing: () => ({ frozen: [], editable: [] }),
}));
vi.mock('./record-signed-date-dialog', () => ({ RecordSignedDateDialog: () => <div role="dialog">signed date</div> }));

beforeEach(() => {
  schedule.installments = [
    stageFixture({ id: 's1', sortOrder: 0, name: 'Advance (mobilisation)', percentage: '0.4000', amount: '165000.00', triggerType: 'ADVANCE', status: 'PAID', releasedBy: { kind: 'ADVANCE' }, invoiceId: 'inv-121', invoiceState: 'ISSUED' }),
    stageFixture({ id: 's2', sortOrder: 1, name: 'Substructure complete', status: 'NEXT', releasedBy: { kind: 'MILESTONE', milestoneId: 'm1', milestoneCode: 'MS-01', milestoneName: 'Substructure complete', verifiedAt: '2026-09-26' } }),
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
    expect(within(rows[2]!).getByText('Upcoming')).toBeInTheDocument();
    expect(within(rows[2]!).getByRole('link', { name: 'Waits for MS-02 to be verified' })).toHaveAttribute('href', '/projects/p1/progress/review');
    expect(within(rows[3]!).getByText('Milestone · not linked yet')).toBeInTheDocument();
    expect(within(rows[3]!).getByRole('link', { name: 'Link it to a milestone in Progress › Plan & setup' })).toBeInTheDocument();
    expect(within(rows[0]!).getByText('40%')).toBeInTheDocument();
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
