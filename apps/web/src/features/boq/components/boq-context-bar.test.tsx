import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { BoqWorkspaceResponse } from '@erp/types';

import { renderWithProviders } from '@/test/render';

import { BoqContextBar, type BoqStage } from './boq-context-bar';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const draftVersion = {
  id: 'v1',
  boqId: 'b1',
  versionNumber: 1,
  status: 'DRAFT' as const,
  createdBy: 'u1',
  createdAt: '2026-09-20T00:00:00.000Z',
  updatedAt: '2026-09-20T00:00:00.000Z',
  totalAmount: '71270.00',
  itemCount: 11,
  isContractBaseline: false,
};

function workspace(overrides: Partial<BoqWorkspaceResponse> = {}): BoqWorkspaceResponse {
  return {
    projectId: 'p1',
    boq: null,
    currency: 'USD',
    draft: draftVersion,
    approved: null,
    contractBaseline: null,
    versions: [draftVersion],
    readiness: null,
    revision: null,
    moneyBand: null,
    mainContractStatus: null,
    compareToSignedAvailable: false,
    capabilities: {
      canView: true,
      canManage: true,
      canCommit: true,
      canViewCommercials: true,
      canViewCost: true,
      canViewMargin: true,
      canEdit: true,
    },
    ...overrides,
  };
}

const DRAFT: BoqStage = { editable: true, signed: false, committed: false };

function render(
  props: Partial<Parameters<typeof BoqContextBar>[0]> = {},
  counts = { sections: 3, items: 11, priced: 10 },
) {
  const handlers = {
    onShowUnpriced: vi.fn(),
    onAddExtraWork: vi.fn(),
    onImport: vi.fn(),
    onExport: vi.fn(),
    onHistory: vi.fn(),
    onRevise: vi.fn(),
    onDiscard: vi.fn(),
  };
  renderWithProviders(
    <BoqContextBar
      workspace={workspace()}
      stage={DRAFT}
      counts={counts}
      actions={{ canCancelDraft: true, canCreateDraft: false }}
      canCreateContract
      canImport
      createContractHref="/projects/p1/commercial/contract/new"
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

describe('BoqContextBar', () => {
  it('names the BOQ, its status from the registry, and its size', () => {
    render();
    expect(screen.getByRole('heading', { name: 'Bill of quantities' })).toBeInTheDocument();
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByText('3 sections · 11 items')).toBeInTheDocument();
    expect(screen.getByText('10 of 11')).toBeInTheDocument();
    expect(screen.getByText('$71,270.00')).toBeInTheDocument();
    // The old brand-blue life-stage label is gone.
    expect(screen.queryByText('Working · draft')).not.toBeInTheDocument();
  });

  /**
   * ADR-032 retired the user-facing baseline/commit: signing the contract takes the snapshot. So
   * there is never a "Baseline" or "Commit" primary — unpriced lines are pointed out, and the
   * next step is the contract.
   */
  it('never offers a baseline/commit step, and points at unpriced lines with a way to see them', async () => {
    const user = userEvent.setup();
    const handlers = render();
    expect(screen.queryByRole('button', { name: /baseline|commit/i })).not.toBeInTheDocument();
    expect(screen.getByText("1 item isn't fully priced (unit, quantity and rate).")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show unpriced' }));
    expect(handlers.onShowUnpriced).toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Create contract' })).toHaveAttribute(
      'href',
      '/projects/p1/commercial/contract/new',
    );
  });

  it('shows no primary — not a disabled one — to someone who cannot record the contract, and says who can', () => {
    render({ canCreateContract: false }, { sections: 3, items: 11, priced: 11 });
    expect(screen.queryByRole('link', { name: 'Create contract' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create contract' })).not.toBeInTheDocument();
    expect(screen.getByText('The commercial team creates the contract from this BOQ.')).toBeInTheDocument();
  });

  it('after signing, the next step is extra work, and the discard is gone', async () => {
    const user = userEvent.setup();
    render({ stage: { editable: true, signed: true, committed: false } });
    expect(screen.getByRole('button', { name: 'Add extra work' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Create contract' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'BOQ actions' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).queryByRole('menuitem', { name: 'Discard draft…' })).not.toBeInTheDocument();
  });

  it('lists the draft overflow with the destructive command last', async () => {
    const user = userEvent.setup();
    render();
    await user.click(screen.getByRole('button', { name: 'BOQ actions' }));
    const items = within(await screen.findByRole('menu')).getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'Import from spreadsheet…',
      'Export to CSV',
      'History',
      'Discard draft…',
    ]);
  });

  it('tells a money-blind reader what is hidden, and shows no money', () => {
    render({
      workspace: workspace({
        draft: { ...draftVersion, totalAmount: null },
        capabilities: { ...workspace().capabilities, canViewCost: false, canViewMargin: false, canViewCommercials: false },
      }),
    });
    expect(screen.getByText('Rates and amounts are hidden for your role.')).toBeInTheDocument();
    expect(screen.queryByText('Total')).not.toBeInTheDocument();
    expect(screen.queryByText('Priced')).not.toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });
});
