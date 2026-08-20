import { screen } from '@testing-library/react';
import { WorkflowTransactionType } from '@erp/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import type { WorkflowStep } from '../types';

/**
 * The approval panel.
 *
 * The assertion that matters most is that the panel says its role check is its own. The server
 * records who acted and never verifies they hold the step's `roleRequired` (#45), so a screen
 * that looked authoritative would be worse than one that admits what it is.
 */

const approvalMocks = vi.hoisted(() => ({
  useApprovalStep: vi.fn(),
  useApprovalAction: vi.fn(),
}));
const definitionMocks = vi.hoisted(() => ({ useWorkflowDefinition: vi.fn() }));
const sessionMocks = vi.hoisted(() => ({ useSession: vi.fn() }));

vi.mock('../hooks/use-approval', () => approvalMocks);
vi.mock('../hooks/use-workflow-definition', () => definitionMocks);
vi.mock('@/features/auth/session/use-session', () => sessionMocks);

import { ApprovalPanel } from './approval-panel';

function step(id: string, stepOrder: number, roleRequired: string): WorkflowStep {
  return {
    id,
    definitionId: 'def-1',
    stepOrder,
    groupOrder: null,
    roleRequired,
    isOptional: false,
    escalateAfterHours: null,
    notifyRoles: [],
  };
}

const STEP = step('s-2', 2, 'COMMERCIAL_MANAGER');
const DEFINITION = {
  steps: [step('s-1', 1, 'PROJECT_MANAGER'), STEP, step('s-3', 3, 'CEO')],
};

function render(props?: { instanceId?: string | null }) {
  return renderWithProviders(
    <ApprovalPanel
      instanceId={props?.instanceId === undefined ? 'inst-1' : props.instanceId}
      transactionType={WorkflowTransactionType.PURCHASE_ORDER}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  approvalMocks.useApprovalStep.mockReturnValue({
    data: STEP,
    isPending: false,
    isError: false,
  });
  approvalMocks.useApprovalAction.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    error: null,
  });
  definitionMocks.useWorkflowDefinition.mockReturnValue({ data: DEFINITION });
  sessionMocks.useSession.mockReturnValue({
    user: { id: 'u-1', roles: ['COMMERCIAL_MANAGER'] },
    accessToken: 't',
  });
});

describe('ApprovalPanel', () => {
  /** A document never submitted for approval has no instance and no panel. */
  it('renders nothing when the document has no approval instance', () => {
    const { container } = render({ instanceId: null });

    expect(container).toBeEmptyDOMElement();
  });

  it('names the role the step is waiting on, and its position in the chain', () => {
    render();

    expect(screen.getByText('Waiting on COMMERCIAL_MANAGER — step 2 of 3.')).toBeInTheDocument();
  });

  /** #45. The whole point of the panel being honest about itself. */
  it('states that the role check is the browser’s own, not the server’s', () => {
    render();

    expect(screen.getByText(/checked here, in the browser, only/i)).toBeInTheDocument();
    expect(screen.getByText(/issue #45/i)).toBeInTheDocument();
  });

  it('offers both decisions to the holder of the required role', () => {
    render();

    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeEnabled();
  });

  it('disables both decisions for someone without the role, and says whose step it is', () => {
    sessionMocks.useSession.mockReturnValue({
      user: { id: 'u-2', roles: ['SITE_ENGINEER'] },
      accessToken: 't',
    });
    render();

    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled();
    expect(screen.getByText('This step is reserved for COMMERCIAL_MANAGER.')).toBeInTheDocument();
  });

  it('offers no decision when nothing is pending', () => {
    approvalMocks.useApprovalStep.mockReturnValue({
      data: null,
      isPending: false,
      isError: false,
    });
    render();

    expect(screen.getByText('No step is waiting on a decision.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('falls back to naming the role when the step is not in the definition', () => {
    definitionMocks.useWorkflowDefinition.mockReturnValue({ data: { steps: [] } });
    render();

    expect(screen.getByText('Waiting on COMMERCIAL_MANAGER.')).toBeInTheDocument();
  });

  it('surfaces a load failure rather than an empty panel', () => {
    approvalMocks.useApprovalStep.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
    });
    render();

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

});
