import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { DocumentPaper } from '@erp/ui';

import { renderWithProviders } from '@/test/render';

import { makeInvoiceDocument } from './invoice-document.fixture';
import { InvoicePaper } from './invoice-paper';

describe('DocumentPaper (@erp/ui)', () => {
  const base = {
    issuer: { name: 'ACCO Ltd', address: 'Olow Tower' },
    title: 'INVOICE',
    numberPendingLabel: 'Number assigned on issue',
    billTo: { label: 'Bill to', name: 'Client Co' },
    columns: { description: 'Description', amount: 'Amount (USD)' },
    lines: [
      { key: 'a', description: 'Stage 1', detail: 'Advance', amount: '$10.00' },
      { key: 'b', description: 'Stage 2', amount: '$20.00' },
    ],
    totals: [{ label: 'Subtotal', value: '$30.00' }],
    total: { label: 'Total due', value: '$31.50' },
  };

  it('renders issuer, bill-to, every line with its amount, and the totals', () => {
    render(<DocumentPaper {...base} number="INV-0007" />);
    const paper = screen.getByRole('article', { name: 'INVOICE' });
    expect(within(paper).getByText('ACCO Ltd')).toBeInTheDocument();
    expect(within(paper).getByText('Client Co')).toBeInTheDocument();
    expect(within(paper).getByText('INV-0007')).toBeInTheDocument();
    expect(within(paper).getByText('Stage 1')).toBeInTheDocument();
    expect(within(paper).getByText('Advance')).toBeInTheDocument();
    expect(within(paper).getByText('$20.00')).toBeInTheDocument();
    expect(within(paper).getByText('Total due')).toBeInTheDocument();
    expect(within(paper).getByText('$31.50')).toBeInTheDocument();
    expect(within(paper).queryByText('Number assigned on issue')).not.toBeInTheDocument();
  });

  it('says the number comes on issue while there is none', () => {
    render(<DocumentPaper {...base} number={null} />);
    expect(screen.getByText('Number assigned on issue')).toBeInTheDocument();
  });

  it('draws the watermark only when asked, hidden from assistive tech', () => {
    const { rerender } = render(<DocumentPaper {...base} number={null} watermark="Draft" />);
    const mark = screen.getByTestId('document-paper-watermark');
    expect(mark).toHaveAttribute('aria-hidden', 'true');
    expect(mark).toHaveTextContent('Draft');
    rerender(<DocumentPaper {...base} number="INV-1" />);
    expect(screen.queryByTestId('document-paper-watermark')).not.toBeInTheDocument();
  });

  it('replaces the totals with one sentence when money is hidden', () => {
    render(<DocumentPaper {...base} number={null} totalsHiddenLabel="Amounts are hidden for your role." />);
    expect(screen.getByText('Amounts are hidden for your role.')).toBeInTheDocument();
    expect(screen.queryByText('Total due')).not.toBeInTheDocument();
  });
});

describe('InvoicePaper — the invoice document on paper', () => {
  it('draws a draft from the server document: no number yet, Net 30, server tax label, watermark', () => {
    renderWithProviders(<InvoicePaper document={makeInvoiceDocument()} />);
    const paper = screen.getByRole('article', { name: 'Invoice preview' });
    expect(within(paper).getByText('INVOICE')).toBeInTheDocument();
    expect(within(paper).getByText('Number assigned on issue')).toBeInTheDocument();
    expect(within(paper).getByText('On issue')).toBeInTheDocument();
    expect(within(paper).getByText('Net 30')).toBeInTheDocument();
    expect(within(paper).getByText('Sales tax 5%')).toBeInTheDocument();
    expect(within(paper).getByText('$8,100.00')).toBeInTheDocument();
    expect(within(paper).getByText('$170,100.00')).toBeInTheDocument();
    expect(within(paper).getByText('Olow Tower, Mogadishu')).toBeInTheDocument();
    expect(within(paper).getByText('Tax registration TIN-778')).toBeInTheDocument();
    expect(screen.getByTestId('document-paper-watermark')).toHaveTextContent('Draft');
  });

  it('shows the number and no watermark once issued', () => {
    renderWithProviders(
      <InvoicePaper
        document={makeInvoiceDocument({
          lifecycle: 'ISSUED',
          invoiceNumber: 'INV-0042',
          invoiceDate: '2026-09-21',
          dueDate: '2026-10-21',
        })}
      />,
    );
    expect(screen.getByText('INV-0042')).toBeInTheDocument();
    expect(screen.getByText('Oct 21, 2026')).toBeInTheDocument();
    expect(screen.queryByTestId('document-paper-watermark')).not.toBeInTheDocument();
  });

  it('money-blind: every amount shows the hidden state and the totals become one sentence — never $0', () => {
    renderWithProviders(
      <InvoicePaper
        document={makeInvoiceDocument({
          financialsVisible: false,
          lines: [{ description: 'Stage 2', detail: null, amount: null }],
          subtotal: null,
          taxAmount: null,
          total: null,
          balanceDue: null,
        })}
      />,
    );
    expect(screen.getAllByText('Hidden by permission').length).toBeGreaterThan(0);
    expect(screen.getByText('Amounts are hidden for your role.')).toBeInTheDocument();
    expect(screen.queryByText(/\$0/)).not.toBeInTheDocument();
    expect(screen.queryByText('Total due')).not.toBeInTheDocument();
  });
});
