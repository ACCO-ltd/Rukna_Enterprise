import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { ProjectInvoicePage } from './project-invoice-page';

let searchParams = new URLSearchParams();
vi.mock('next/navigation', () => ({ useSearchParams: () => searchParams }));
vi.mock('@/features/accounting/components/invoice-detail', () => ({
  InvoiceDetail: ({ back }: { back: { href: string; label: string } }) => (
    <a data-testid="back" href={back.href}>
      {back.label}
    </a>
  ),
}));


describe('ProjectInvoicePage — an invoice opened inside the project (flow plan PR 4)', () => {
  it('returns to Billing & collection by default', () => {
    searchParams = new URLSearchParams();
    renderWithProviders(<ProjectInvoicePage projectId="p1" invoiceId="i1" />);
    expect(screen.getByTestId('back')).toHaveAttribute('href', '/projects/p1/commercial/billing-collection');
  });

  it('keeps the list filter it came from, and names the tab it returns to', () => {
    searchParams = new URLSearchParams({ from: '/projects/p1/commercial/contract-milestones' });
    renderWithProviders(<ProjectInvoicePage projectId="p1" invoiceId="i1" />);
    const back = screen.getByTestId('back');
    expect(back).toHaveAttribute('href', '/projects/p1/commercial/contract-milestones');
    expect(back).toHaveTextContent('Contract & milestones');
  });

  it('ignores a `from` that leaves the project', () => {
    searchParams = new URLSearchParams({ from: 'https://evil.example/phish' });
    renderWithProviders(<ProjectInvoicePage projectId="p1" invoiceId="i1" />);
    expect(screen.getByTestId('back')).toHaveAttribute('href', '/projects/p1/commercial/billing-collection');
  });
});
