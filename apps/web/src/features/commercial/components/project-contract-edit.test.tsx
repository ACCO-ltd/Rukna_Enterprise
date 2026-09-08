import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

/**
 * The workspace edit route carries only the project (a project has exactly one CLIENT_CONTRACT),
 * so ProjectContractEdit resolves the contract id from the commercial summary before mounting the
 * shared editor (P3 Slice B). These pin the four states: loading, resolve → edit, no-contract, and
 * a graceful summary failure.
 */

const mocks = vi.hoisted(() => ({
  useCommercialSummary: vi.fn(),
  ContractEdit: vi.fn(),
}));

vi.mock('../hooks/use-commercial', () => ({ useCommercialSummary: mocks.useCommercialSummary }));
vi.mock('@/features/contracts/components/contract-edit', () => ({
  ContractEdit: (props: { id: string; projectId?: string }) => {
    mocks.ContractEdit(props);
    return <div data-testid="contract-edit">edit {props.id}</div>;
  },
}));
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

import { ProjectContractEdit } from './project-contract-edit';

const PROJECT_ID = 'p-77';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ProjectContractEdit', () => {
  it('resolves the main contract id from the summary and mounts the editor', () => {
    mocks.useCommercialSummary.mockReturnValue({
      data: { mainContract: { id: 'c-9' } },
      isPending: false,
      isError: false,
    });

    renderWithProviders(<ProjectContractEdit projectId={PROJECT_ID} />);

    expect(screen.getByTestId('contract-edit')).toBeInTheDocument();
    expect(mocks.ContractEdit).toHaveBeenCalledWith({ id: 'c-9', projectId: PROJECT_ID });
  });

  it('shows a loading status while the summary is in flight', () => {
    mocks.useCommercialSummary.mockReturnValue({ data: undefined, isPending: true, isError: false });

    renderWithProviders(<ProjectContractEdit projectId={PROJECT_ID} />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(mocks.ContractEdit).not.toHaveBeenCalled();
  });

  it('offers to create one when the project has no main contract', () => {
    mocks.useCommercialSummary.mockReturnValue({
      data: { mainContract: null },
      isPending: false,
      isError: false,
    });

    renderWithProviders(<ProjectContractEdit projectId={PROJECT_ID} />);

    expect(mocks.ContractEdit).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: /create contract/i })).toHaveAttribute(
      'href',
      `/projects/${PROJECT_ID}/commercial/contract/new`,
    );
  });

  it('shows a graceful failure with a return path when the summary errors', () => {
    mocks.useCommercialSummary.mockReturnValue({ data: undefined, isPending: false, isError: true });

    renderWithProviders(<ProjectContractEdit projectId={PROJECT_ID} />);

    expect(mocks.ContractEdit).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: /back to contract & security/i })).toHaveAttribute(
      'href',
      `/projects/${PROJECT_ID}/commercial/contract-security`,
    );
  });
});
