import { act, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { sessionStore } from '@/features/auth/session/session-store';
import { renderWithProviders } from '@/test/render';

import { ProjectInvoiceRedirect, projectInvoiceTarget } from './project-invoice-redirect';

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/projects/p1/commercial/invoices/inv-1' }));

beforeEach(() => {
  router.replace.mockReset();
});

describe('projectInvoiceTarget (ADR-043 Phase 3)', () => {
  it('sends a finance reader to the invoice in Finance, anyone else to the Commercial schedule', () => {
    expect(projectInvoiceTarget('p1', 'inv-1', true)).toBe('/finance/projects/p1/billing/invoices/inv-1');
    expect(projectInvoiceTarget('p1', 'inv-1', false)).toBe('/projects/p1/commercial/contract');
  });
});

describe('ProjectInvoiceRedirect', () => {
  it('a finance reader (view:financial-position) continues to the invoice in Finance', async () => {
    renderWithProviders(<ProjectInvoiceRedirect projectId="p1" invoiceId="inv-1" />, {
      permissions: ['view:contract', 'view:financial-position', 'manage:receivable'],
    });
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/finance/projects/p1/billing/invoices/inv-1'));
  });

  it('a Construction Director (view:contract, no finance permission) lands on the schedule, not on an invoice', async () => {
    renderWithProviders(<ProjectInvoiceRedirect projectId="p1" invoiceId="inv-1" />, {
      permissions: ['view:contract', 'manage:project'],
    });
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/projects/p1/commercial/contract'));
    expect(router.replace).not.toHaveBeenCalledWith(expect.stringContaining('/finance/'));
  });

  it('decides nothing until the permissions are known, then follows them (a finance reader is not sent to the schedule)', async () => {
    renderWithProviders(<ProjectInvoiceRedirect projectId="p1" invoiceId="inv-1" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    // no session yet (hydration snapshot) — no redirect at all
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(router.replace).not.toHaveBeenCalled();

    act(() => {
      sessionStore.setSession({
        accessToken: 't',
        user: {
          id: 'u',
          email: 'f@example.com',
          name: null,
          orgId: 'org-1',
          tenantSlug: 'test',
          roles: [],
          permissions: ['view:financial-position'],
        },
      });
    });
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/finance/projects/p1/billing/invoices/inv-1'));
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalledWith('/projects/p1/commercial/contract');
  });
});
