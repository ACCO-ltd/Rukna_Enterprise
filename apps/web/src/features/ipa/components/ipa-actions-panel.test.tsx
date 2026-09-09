import { IpaStatus } from '@erp/types';
import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import type { IpaDetail } from '../types';

import { IpaActionsPanel } from './ipa-actions-panel';

/**
 * The certificate CTA must point into the project workspace (P3 Slice C):
 * `${basePath}/${ipa.id}/certificates/new`, where `basePath` is
 * `/projects/:id/commercial/applications`. It must never resolve to the retired
 * `/contracts/:id/applications/:ipaId/certificates/new` route.
 */

const mocks = vi.hoisted(() => ({
  useIpcs: vi.fn(),
  useIpaCommand: vi.fn(),
  useCancelIpa: vi.fn(),
}));

vi.mock('@/features/ipc/hooks/use-ipc', () => ({ useIpcs: mocks.useIpcs }));
vi.mock('../hooks/use-ipa', () => ({
  useIpaCommand: mocks.useIpaCommand,
  useCancelIpa: mocks.useCancelIpa,
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

const BASE_PATH = '/projects/p-1/commercial/applications';

function submittedIpa(): IpaDetail {
  return {
    id: 'ipa-9',
    contractId: 'con-1',
    organizationId: 'org-1',
    applicationNumber: 1,
    applicationRef: 'IPA-001',
    status: IpaStatus.SUBMITTED,
    periodFrom: null,
    periodTo: null,
    submittedAt: null,
    submittedBy: null,
    notes: null,
    createdBy: 'user-1',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    items: [],
    deductions: [],
    attachments: [],
    totalPeriodAmount: '0.00',
    totalDeductions: '0.00',
    netPayable: '0.00',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useIpcs.mockReturnValue({ data: [] });
  mocks.useIpaCommand.mockReturnValue({ mutate: vi.fn(), reset: vi.fn(), isPending: false });
  mocks.useCancelIpa.mockReturnValue({ mutate: vi.fn(), reset: vi.fn(), isPending: false });
});

describe('IpaActionsPanel — certificate CTA', () => {
  it('links the certificate CTA to the project-scoped route', () => {
    renderWithProviders(<IpaActionsPanel ipa={submittedIpa()} basePath={BASE_PATH} />);

    const cta = screen.getByRole('link');
    expect(cta).toHaveAttribute('href', `${BASE_PATH}/ipa-9/certificates/new`);
    // Specifically: never the retired /contracts/* route.
    expect(cta.getAttribute('href')).not.toContain('/contracts/');
  });
});
