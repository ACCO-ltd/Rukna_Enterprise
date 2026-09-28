import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { OVERDUE, READY, workspaceFixture } from '../test-fixtures';
import { CommercialWorkspace } from './commercial-workspace';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/projects/p1/commercial/billing' }));

const workspace = vi.hoisted(() => ({ value: undefined as unknown }));
vi.mock('../hooks/use-commercial-workspace', () => ({
  useCommercialWorkspace: () => ({ isPending: false, isError: false, data: workspace.value }),
}));
vi.mock('../hooks/use-commercial', () => ({
  commercialKeys: { all: (id: string) => ['commercial', id] },
  useCommercialSummary: () => ({ data: undefined }),
}));
vi.mock('../api/commercial-workspace-api', () => ({ getClientStatement: vi.fn() }));
const reopen = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock('@/features/contracts/hooks/use-contracts', () => ({
  useReopenContract: () => ({ ...reopen, isPending: false, isError: false, reset: vi.fn() }),
}));
vi.mock('./commercial-billing-view', () => ({ CommercialBillingView: () => <div>billing view</div> }));
vi.mock('./commercial-contract-view', () => ({ CommercialContractView: () => <div>contract view</div> }));
vi.mock('./applications-tab', () => ({ ApplicationsTab: () => <div>applications view</div> }));

beforeEach(() => {
  router.replace.mockReset();
  reopen.mutate.mockReset();
});

describe('Commercial — no contract', () => {
  it('is one empty state with the one way forward and the BOQ it will be signed against — no bar, no views', () => {
    workspace.value = workspaceFixture({
      contract: null,
      signBoq: { versionId: 'v1', versionNumber: 1 },
      capabilities: { ...workspaceFixture().capabilities, canRecordContract: true },
    });
    renderWithProviders(<CommercialWorkspace projectId="p1" active="billing" />, { withToast: true });
    expect(screen.getByText('No contract yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Record signed contract' })).toHaveAttribute('href', '/projects/p1/commercial/contract/new');
    expect(screen.getByRole('link', { name: 'BOQ version 1' })).toBeInTheDocument();
    expect(screen.queryByText('Contract value')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Commercial views' })).not.toBeInTheDocument();
  });

  it('offers no command to someone who cannot record it', () => {
    workspace.value = workspaceFixture({ contract: null });
    renderWithProviders(<CommercialWorkspace projectId="p1" active="billing" />, { withToast: true });
    expect(screen.queryByRole('link', { name: 'Record signed contract' })).not.toBeInTheDocument();
    expect(screen.getByText('The commercial team records the signed contract.')).toBeInTheDocument();
  });
});

describe('Commercial — with a contract', () => {
  it('shows the contract bar with its five facts and no primary, then Billing · Contract with the To do count', () => {
    workspace.value = workspaceFixture({ todo: [OVERDUE, READY] });
    renderWithProviders(<CommercialWorkspace projectId="p1" active="billing" />, { withToast: true });
    expect(screen.getByRole('heading', { name: 'Main contract C1' })).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    for (const label of ['Contract value', 'Invoiced', 'Collected', 'Outstanding', 'Overdue']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText('$12,600.00', { selector: '.text-danger' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Commercial views' });
    expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual(['Billing2', 'Contract']);
    expect(screen.queryByText('Overview')).not.toBeInTheDocument();
    expect(screen.getByText('billing view')).toBeInTheDocument();
  });

  it('lands billers on Billing and everyone else on Contract', async () => {
    workspace.value = workspaceFixture();
    const { unmount } = renderWithProviders(<CommercialWorkspace projectId="p1" active="landing" />, { withToast: true });
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/projects/p1/commercial/billing'));
    unmount();
    router.replace.mockReset();
    workspace.value = workspaceFixture({ capabilities: { ...workspaceFixture().capabilities, canBill: false } });
    renderWithProviders(<CommercialWorkspace projectId="p1" active="landing" />, { withToast: true });
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/projects/p1/commercial/contract'));
  });

  it('keeps Applications to measured contracts', () => {
    workspace.value = workspaceFixture();
    renderWithProviders(<CommercialWorkspace projectId="p1" active="applications" />, { withToast: true });
    expect(screen.getByText('No applications for this contract')).toBeInTheDocument();
  });

  it('reopening needs a reason, and runs only from the kebab when allowed', async () => {
    const user = userEvent.setup();
    workspace.value = workspaceFixture();
    renderWithProviders(<CommercialWorkspace projectId="p1" active="contract" />, { withToast: true });
    await user.click(screen.getByRole('button', { name: 'Contract actions' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'New separate charge…',
      'Export client statement',
      'Reopen contract to draft…',
    ]);
    await user.click(within(menu).getByRole('menuitem', { name: 'Reopen contract to draft…' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Reopen to draft' }));
    expect(reopen.mutate).not.toHaveBeenCalled();
    await user.type(within(dialog).getByRole('textbox'), 'Client asked to re-price stage 3');
    await user.click(within(dialog).getByRole('button', { name: 'Reopen to draft' }));
    expect(reopen.mutate).toHaveBeenCalledWith('Client asked to re-price stage 3', expect.anything());
  });

  it('shows no kebab to a reader with no contract commands', () => {
    workspace.value = workspaceFixture({
      capabilities: { ...workspaceFixture().capabilities, canBill: false, canExportStatement: false, canReopenContract: false },
    });
    renderWithProviders(<CommercialWorkspace projectId="p1" active="contract" />, { withToast: true });
    expect(screen.queryByRole('button', { name: 'Contract actions' })).not.toBeInTheDocument();
  });
});
