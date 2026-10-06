import {
  buildInvoiceLines,
  buildInvoiceViewModel,
  clientAddressLines,
  invoiceNotes,
  paymentTermsLabel,
  salesTaxLabel,
  type InvoiceLineSource,
} from './invoice-view-model';
import { brandView, footerColumns } from './pdf-kit';
import { bankNotesInvoiceFixture, minimalInvoiceFixture } from './document-pdf.fixtures';

describe('buildInvoiceViewModel — the minimal layout', () => {
  const vm = buildInvoiceViewModel(minimalInvoiceFixture);

  it('puts the invoice facts in the header in the mock order', () => {
    expect(vm.title).toBe('INVOICE');
    expect(vm.meta).toEqual([
      { label: 'Invoice No.', value: 'INV-000003' },
      { label: 'Invoice Date', value: 'Oct 4, 2026' },
      { label: 'Due Date', value: 'Nov 3, 2026' },
      { label: 'Payment Terms', value: 'Net 30 days' },
    ]);
  });

  it('omits the due date and terms when the invoice has neither, and prints DRAFT unnumbered', () => {
    const draft = buildInvoiceViewModel({ ...minimalInvoiceFixture, invoiceNumber: null, dueDate: null, paymentTerms: null });
    expect(draft.meta.map((m) => m.label)).toEqual(['Invoice No.', 'Invoice Date']);
    expect(draft.meta[0].value).toBe('DRAFT');
  });

  it('brands with the name as wordmark, the upper-cased tagline, address and tax number', () => {
    expect(vm.brand).toMatchObject({
      orgName: 'ACCO Ltd',
      logoSrc: null,
      tagline: 'CONSTRUCTION & DEVELOPMENT',
      addressLines: ['Olow Tower, Maka Al-Mukarama Road', 'Mogadishu, Somalia'],
      taxLine: 'Tax Reg. 100045678',
    });
    expect(brandView({ ...minimalInvoiceFixture.org, tagline: '  ' }).tagline).toBeNull();
  });

  it('shows Bill To and Project as two plain columns (project name and location on one line)', () => {
    expect(vm.billTo).toEqual({
      label: 'Bill To',
      name: 'Ahmed Shirie',
      lines: ['Mogadishu, Somalia', 'Tax Reg. 254708023039'],
    });
    expect(vm.project).toEqual({ label: 'Project', name: 'ACCO-DHL-26-0012', lines: ['ABC, Dharkeynley, KM4, Mogadishu'] });
    expect(buildInvoiceViewModel({ ...minimalInvoiceFixture, project: null }).project).toBeNull();
    expect(
      buildInvoiceViewModel({ ...minimalInvoiceFixture, client: { ...minimalInvoiceFixture.client, taxNumber: null } }).billTo.lines,
    ).toContain('Tax Reg. —');
  });

  it('labels the table in normal case with the currency, and totals with "Sales Tax (5%)"', () => {
    expect(vm.columns).toEqual({
      index: '#',
      description: 'Description',
      quantity: 'Qty',
      unitPrice: 'Unit Price (USD)',
      amount: 'Amount (USD)',
    });
    expect(vm.lines).toEqual([
      {
        index: '1',
        title: 'Stage 1 of 4 – Advance (mobilisation)',
        detail: '40% of the contract value of USD 20,000.00',
        quantity: '1',
        unitPrice: '8,000.00',
        amount: '8,000.00',
      },
    ]);
    expect(vm.totals).toEqual([
      { label: 'Subtotal', value: 'USD 8,000.00' },
      { label: 'Sales Tax (5%)', value: 'USD 400.00' },
    ]);
    expect(vm.total).toEqual({ label: 'Total Due', value: 'USD 8,400.00' });
  });

  it('falls back to one line for the subtotal when the invoice has no lines', () => {
    const empty = buildInvoiceViewModel({ ...minimalInvoiceFixture, lines: [] });
    expect(empty.lines).toHaveLength(1);
    expect(empty.lines[0]).toMatchObject({ title: 'Invoice INV-000003', amount: '8,000.00', detail: null });
  });

  it('builds the footer strip: address, phones, email + website', () => {
    expect(vm.footer).toEqual([
      { icon: 'pin', lines: ['Olow Tower, Maka Al-Mukarama Road', 'Mogadishu, Somalia'] },
      { icon: 'phone', lines: ['+252 61 234 5678', '+252 90 123 4567'] },
      { icon: 'mail', lines: ['info@acco.com', 'www.acco.com'] },
    ]);
  });

  it('leaves the bank details and notes out unless the settings switch them on', () => {
    expect(vm.payment).toBeNull();
    expect(vm.notes).toEqual([]);
    const on = buildInvoiceViewModel(bankNotesInvoiceFixture);
    expect(on.payment?.rows).toHaveLength(4);
    expect(on.payment?.reference).toEqual({ label: 'Reference', value: 'INV-000003' });
    expect(on.notes[0]).toBe('Please quote the invoice number in your payment.');
  });

  it('omits the bank section with no complete rows even when switched on, and skips incomplete rows', () => {
    expect(buildInvoiceViewModel({ ...bankNotesInvoiceFixture, paymentAccounts: [] }).payment).toBeNull();
    const partial = buildInvoiceViewModel({
      ...bankNotesInvoiceFixture,
      paymentAccounts: [
        { bankName: ' Salaam Bank ', accountNumber: ' 1 ' },
        { bankName: 'Ghost', accountNumber: '' },
      ],
    });
    expect(partial.payment?.rows).toEqual([{ bank: 'Salaam Bank', accountNumber: '1' }]);
  });

  it('signs with name, title, company and date, or leaves the line blank', () => {
    expect(vm.signature).toEqual({ name: 'Ahmed Abdi Hassan', title: 'CEO', company: 'ACCO Ltd', date: 'Oct 4, 2026' });
    const blank = buildInvoiceViewModel({ ...minimalInvoiceFixture, signatory: null }).signature;
    expect(blank.name).toBeNull();
    expect(blank.title).toBeNull();
  });
});

describe('footerColumns', () => {
  it('falls back to the legal address, keeps two lines/phones at most, and drops empty columns', () => {
    expect(footerColumns(null, 'A\nB\nC')).toEqual([{ icon: 'pin', lines: ['A', 'B'] }]);
    expect(footerColumns({ address: null, phones: ['1', '2', '3'], email: null, website: ' ' }, null)).toEqual([
      { icon: 'phone', lines: ['1', '2'] },
    ]);
    expect(footerColumns({ address: null, phones: [], email: null, website: null }, null)).toEqual([]);
  });

  it('cuts an over-long line (a 300-character address) so it cannot overflow the strip', () => {
    const [address] = footerColumns({ address: 'x'.repeat(300), phones: [], email: null, website: null }, null);
    expect(address.lines[0]).toHaveLength(60);
    expect(address.lines[0].endsWith('\u2026')).toBe(true);
  });

  it('accepts only a valid brand colour', () => {
    const base = { ...minimalInvoiceFixture.org };
    expect(brandView(base).palette.accent).toBe('#1F3FA8');
    expect(brandView({ ...base, brandColorHex: '#0f766e' }).palette.accent).toBe('#0F766E');
    expect(brandView({ ...base, brandColorHex: 'red' }).palette.accent).toBe('#1F3FA8');
  });
});

describe('salesTaxLabel', () => {
  it('uses the invoice rate (ADR-041), trimmed', () => {
    expect(salesTaxLabel({ taxRatePercent: '5.0000', subtotal: '100', vatAmount: '5' })).toBe('Sales Tax (5%)');
    expect(salesTaxLabel({ taxRatePercent: '12.5', subtotal: '100', vatAmount: '12.5' })).toBe('Sales Tax (12.5%)');
    expect(salesTaxLabel({ taxRatePercent: '0', subtotal: '100', vatAmount: '0' })).toBe('Sales Tax (0%)');
  });

  it('derives the rate from the amounts only without one, and drops it when it cannot', () => {
    expect(salesTaxLabel({ taxRatePercent: null, subtotal: '200', vatAmount: '10' })).toBe('Sales Tax (5%)');
    expect(salesTaxLabel({ taxRatePercent: null, subtotal: '0', vatAmount: '0' })).toBe('Sales Tax');
  });
});

describe('paymentTermsLabel', () => {
  const day = (d: string) => new Date(`${d}T00:00:00Z`);
  it('reads bare numbers and "Net N" as days', () => {
    expect(paymentTermsLabel('30', day('2026-10-01'), null)).toEqual({ label: 'Net 30 days', days: 30 });
    expect(paymentTermsLabel('Net 45', day('2026-10-01'), null)).toEqual({ label: 'Net 45 days', days: 45 });
  });
  it('prints free text as typed', () => {
    expect(paymentTermsLabel('Due on receipt', day('2026-10-01'), null)).toEqual({ label: 'Due on receipt', days: null });
  });
  it('falls back to the due date, else nothing', () => {
    expect(paymentTermsLabel(null, day('2026-10-01'), day('2026-10-15'))).toEqual({ label: 'Net 14 days', days: 14 });
    expect(paymentTermsLabel(null, day('2026-10-01'), null)).toBeNull();
  });
});

describe('invoiceNotes', () => {
  it("uses the organisation's notes, one per line", () => {
    expect(invoiceNotes('First\n\n  Second  \n', 30)).toEqual(['First', 'Second']);
  });
  it('defaults, with the due-within note only when the terms give a day count', () => {
    expect(invoiceNotes(null, 30)).toEqual([
      'Please quote the invoice number in your payment.',
      'This invoice is issued in accordance with the project contract.',
      'Payment is due within 30 days from the invoice date.',
    ]);
    expect(invoiceNotes('   ', null)).toHaveLength(2);
  });
});

describe('clientAddressLines', () => {
  it('adds the city and country, skipping what the address already names', () => {
    expect(
      clientAddressLines({ name: 'C', address: 'Maka Al Mukarama Road', city: 'Mogadishu', countryCode: 'SO', taxNumber: null }),
    ).toEqual(['Maka Al Mukarama Road', 'Mogadishu, Somalia']);
    expect(
      clientAddressLines({ name: 'C', address: 'KM4, Mogadishu', city: 'Mogadishu', countryCode: 'SO', taxNumber: null }),
    ).toEqual(['KM4, Mogadishu', 'Somalia']);
    expect(clientAddressLines({ name: 'C', address: null, city: null, countryCode: null, taxNumber: null })).toEqual([]);
  });
});

describe('buildInvoiceLines', () => {
  const stage = (over: Partial<InvoiceLineSource> = {}): InvoiceLineSource => ({
    description: 'Substructure complete',
    subtotal: '123750.00',
    currencyCode: 'USD',
    contractNumber: 'C-2026-004',
    installment: {
      name: 'Substructure complete',
      position: 2,
      count: 4,
      percentage: '0.3',
      scheduleBase: '412500.00',
    },
    variations: [],
    ...over,
  });

  it('describes a stage invoice by its place in the schedule and its share of the contract', () => {
    expect(buildInvoiceLines(stage())).toEqual([
      {
        title: 'Stage 2 of 4 – Substructure complete',
        detail: '30% of the contract value of USD 412,500.00',
        quantity: '1',
        unitPrice: '123750.00',
        amount: '123750.00',
      },
    ]);
  });

  it('lists omission variations netted into the stage when they reconcile to the subtotal', () => {
    const lines = buildInvoiceLines(
      stage({
        subtotal: '118750.00',
        variations: [
          { reference: 'VO-04', title: 'Delete parapet cladding', clientApproved: true, treatment: 'STAGE_REDUCTION', amount: '5000.00' },
        ],
      }),
    );
    expect(lines.map((l) => [l.title, l.amount])).toEqual([
      ['Stage 2 of 4 – Substructure complete', '123750.00'],
      ['VO-04 Delete parapet cladding', '-5000.00'],
    ]);
  });

  it('rounds the stage amount in Decimal, matching the invoice service (no float drift)', () => {
    // 10.05 × 0.5 = 5.025 → 5.03 half-up; in binary floats 5.025 × 100 is 502.4999… and rounds to 5.02.
    const lines = buildInvoiceLines(
      stage({ subtotal: '5.03', installment: { name: 'S', position: 1, count: 2, percentage: '0.5', scheduleBase: '10.05' } }),
    );
    expect(lines[0]).toMatchObject({ amount: '5.03', detail: '50% of the contract value of USD 10.05' });
  });

  it('never prints a percentage claim that no longer adds up to the subtotal', () => {
    const lines = buildInvoiceLines(stage({ subtotal: '120000.00' }));
    expect(lines).toEqual([
      { title: 'Stage 2 of 4 – Substructure complete', detail: null, quantity: '1', unitPrice: '120000.00', amount: '120000.00' },
    ]);
  });

  it('describes a variation invoice by its reference and approval', () => {
    const variation = (clientApproved: boolean) =>
      buildInvoiceLines({
        description: 'VO-03 — Additional shop fronts',
        subtotal: '18400.00',
        currencyCode: 'USD',
        contractNumber: 'C-2026-004',
        installment: null,
        variations: [{ reference: 'VO-03', title: 'Additional shop fronts', clientApproved, treatment: 'INVOICE', amount: '18400.00' }],
      });
    expect(variation(true)[0]).toMatchObject({ title: 'VO-03 Additional shop fronts', detail: 'Client-approved variation' });
    expect(variation(false)[0].detail).toBe('Variation to contract C-2026-004');
  });

  it('falls back to the frozen description and the contract number', () => {
    expect(
      buildInvoiceLines({
        description: 'Interim Certificate IPC-03',
        subtotal: '5000.00',
        currencyCode: 'USD',
        contractNumber: 'C-1',
        installment: null,
        variations: [],
      }),
    ).toEqual([{ title: 'Interim Certificate IPC-03', detail: 'Contract C-1', quantity: '1', unitPrice: '5000.00', amount: '5000.00' }]);
  });
});
