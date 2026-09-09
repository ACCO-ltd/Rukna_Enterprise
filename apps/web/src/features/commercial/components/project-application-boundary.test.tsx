import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { ProjectApplicationBoundary } from './project-application-boundary';

/**
 * The project-scoped IPA/IPC routes carry only the project in the URL. This boundary resolves the
 * project's single main contract from the commercial summary — the same source Contract & Security
 * reads (`summary.mainContract.id`) — and hands the resolved id to the mounted component. These
 * tests pin: pending, error, no-contract, and the resolved happy path.
 */

const mocks = vi.hoisted(() => ({ useCommercialSummary: vi.fn() }));

vi.mock('../hooks/use-commercial', () => ({ useCommercialSummary: mocks.useCommercialSummary }));

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

beforeEach(() => {
  vi.clearAllMocks();
});

function render() {
  return renderWithProviders(
    <ProjectApplicationBoundary projectId="p-1">
      {(contractId) => <div data-testid="mounted">contract:{contractId}</div>}
    </ProjectApplicationBoundary>,
  );
}

describe('ProjectApplicationBoundary', () => {
  it('shows a loading placeholder while the summary is pending', () => {
    mocks.useCommercialSummary.mockReturnValue({ isPending: true, isError: false });
    render();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByTestId('mounted')).not.toBeInTheDocument();
  });

  it('shows an error with a back link when the summary fails', () => {
    mocks.useCommercialSummary.mockReturnValue({ isPending: false, isError: true });
    render();
    expect(screen.queryByTestId('mounted')).not.toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      '/projects/p-1/commercial/contract-security',
    );
  });

  it('offers to create a contract when the project has no main contract', () => {
    mocks.useCommercialSummary.mockReturnValue({
      isPending: false,
      isError: false,
      data: { mainContract: null },
    });
    render();
    expect(screen.queryByTestId('mounted')).not.toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      '/projects/p-1/commercial/contract/new',
    );
  });

  it('resolves the contract id and mounts the component', () => {
    mocks.useCommercialSummary.mockReturnValue({
      isPending: false,
      isError: false,
      data: { mainContract: { id: 'con-7' } },
    });
    render();
    expect(screen.getByTestId('mounted')).toHaveTextContent('contract:con-7');
  });
});
