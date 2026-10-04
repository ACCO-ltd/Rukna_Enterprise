import {
  buildInvoiceLines,
  buildInvoiceViewModel,
  clientAddressLines,
  invoiceNotes,
  paymentTermsLabel,
  salesTaxLabel,
  type InvoiceLineSource,
} from './invoice-view-model';
import { brandView } from './pdf-kit';
import { shortInvoiceFixture, variationTaxInvoiceFixture } from './document-pdf.fixtures';

describe('buildInvoiceViewModel', () => {
  it('puts the invoice facts in the header in the reference order', () => {
    const vm = buildInvoiceViewModel(shortInvoiceFixture);
    expect(vm.title).toBe('INVOICE');
    expect(vm.meta).toEqual([
      { label: 'Invoice No.', value: 'INV-000123' },
      { label: 'Invoice Date', value: 'Oct 1, 2026' },
      { label: 'Due Date', value: 'Oct 31, 2026' },
      { label: 'Payment Terms', value: 'Net 30 days' },
    ]);
  });

  it('omits the due date and terms when the invoice has neither, and prints DRAFT unnumbered', () => {
    const vm = buildInvoiceViewModel({ ...shortInvoiceFixture, invoiceNumber: null, dueDate: null, paymentTerms: null });
    expect(vm.meta.map((m) => m.label)).toEqual(['Invoice No.', 'Invoice Date']);
    expect(vm.meta[0].value).toBe('DRAFT');
  });

  it('shows the amount due, the currency in the column headers and the totals with the tax rate', () => {
    const vm = buildInvoiceViewModel(variationTaxInvoiceFixture);
    expect(vm.amountDue).toEqual({ label: 'AMOUNT DUE', value: 'USD 19,320.00' });
    expect(vm.columns.unitPrice).toBe('UNIT PRICE (USD)');
    expect(vm.columns.amount).toBe('AMOUNT (USD)');
    expect(vm.totals).toEqual([
      { label: 'Subtotal', value: 'USD 18,400.00', emphasis: false },
      { label: 'Sales Tax 5%', value: 'USD 920.00', emphasis: false },
      { label: 'Total Due', value: 'USD 19,320.00', emphasis: true },
    ]);
  });

  it('renders each line with its sub-description, quantity and grouped amounts', () => {
    const vm = buildInvoiceViewModel(shortInvoiceFixture);
    expect(vm.lines).toEqual([
      {
        index: '1',
        title: 'Stage 2 of 4 – Substructure complete',
        detail: '30% of the contract value of USD 412,500.00',
        quantity: '1',
        unitPrice: '123,750.00',
        amount: '123,750.00',
      },
    ]);
  });

  it('falls back to one line for the subtotal when the invoice has no lines', () => {
    const vm = buildInvoiceViewModel({ ...shortInvoiceFixture, lines: [] });
    expect(vm.lines).toHaveLength(1);
    expect(vm.lines[0]).toMatchObject({ title: 'Invoice INV-000123', amount: '123,750.00', detail: null });
  });

  it('prints the client tax number, or a dash when there is none', () => {
    expect(buildInvoiceViewModel(shortInvoiceFixture).billTo.taxLine).toBe('Tax Reg. —');
    expect(buildInvoiceViewModel(variationTaxInvoiceFixture).billTo.taxLine).toBe('Tax Reg. TIN-555-0192');
  });

  it('omits the project column when the invoice has no project', () => {
    expect(buildInvoiceViewModel({ ...shortInvoiceFixture, project: null }).project).toBeNull();
  });

  describe('bank account details', () => {
    it('prints one row per bank, the full account number, then the reference', () => {
      const vm = buildInvoiceViewModel(shortInvoiceFixture);
      expect(vm.payment).toEqual({
        title: 'Bank Account Details',
        columns: { bank: 'Bank', accountNumber: 'Account number' },
        rows: [
          { bank: 'Salaam Bank', accountNumber: '33020045871' },
          { bank: 'Dahabshiil Bank', accountNumber: '100-2287-4410' },
          { bank: 'Premier Bank', accountNumber: '0102 0033 4410' },
          { bank: 'My Bank', accountNumber: '7700 5512 09' },
        ],
        reference: { label: 'Reference', value: 'INV-000123' },
      });
    });

    it('omits the card with no rows, and skips incomplete rows', () => {
      expect(buildInvoiceViewModel({ ...shortInvoiceFixture, paymentAccounts: [] }).payment).toBeNull();
      expect(
        buildInvoiceViewModel({ ...shortInvoiceFixture, paymentAccounts: [{ bankName: ' ', accountNumber: '1' }] }).payment,
      ).toBeNull();
      const vm = buildInvoiceViewModel({
        ...shortInvoiceFixture,
        paymentAccounts: [
          { bankName: ' Salaam Bank ', accountNumber: ' 1 ' },
          { bankName: 'Ghost', accountNumber: '' },
        ],
      });
      expect(vm.payment?.rows).toEqual([{ bank: 'Salaam Bank', accountNumber: '1' }]);
    });

    it('asks to quote the invoice number on an unnumbered draft', () => {
      expect(buildInvoiceViewModel({ ...shortInvoiceFixture, invoiceNumber: null }).payment?.reference.value).toBe(
        'Quote the invoice number',
      );
    });
  });

  describe('signature', () => {
    it('names the signatory, title, company and date', () => {
      expect(buildInvoiceViewModel(shortInvoiceFixture).signature).toEqual({
        name: 'Ahmed Ali',
        title: 'Finance Manager',
        company: 'Example Construction Ltd',
        date: 'Oct 1, 2026',
      });
    });

    it('leaves the line blank with no signatory', () => {
      const sig = buildInvoiceViewModel({ ...shortInvoiceFixture, signatory: null }).signature;
      expect(sig.name).toBeNull();
      expect(sig.title).toBeNull();
    });
  });
});

describe('salesTaxLabel', () => {
  it('uses the invoice rate (ADR-041), trimmed', () => {
    expect(salesTaxLabel({ taxRatePercent: '5.0000', subtotal: '100', vatAmount: '5' })).toBe('Sales Tax 5%');
    expect(salesTaxLabel({ taxRatePercent: '12.5', subtotal: '100', vatAmount: '12.5' })).toBe('Sales Tax 12.5%');
    expect(salesTaxLabel({ taxRatePercent: '0', subtotal: '100', vatAmount: '0' })).toBe('Sales Tax 0%');
  });

  it('derives the rate from the amounts only without one, and drops it when it cannot', () => {
    expect(salesTaxLabel({ taxRatePercent: null, subtotal: '200', vatAmount: '10' })).toBe('Sales Tax 5%');
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

describe('pdf-kit helpers', () => {
  it('builds the footer line from the last address line, and accepts only a valid brand colour', () => {
    const base = { ...shortInvoiceFixture.org };
    expect(brandView(base).footerLine).toBe('Example Construction Ltd · Mogadishu, Somalia');
    expect(brandView({ ...base, legalAddress: null }).footerLine).toBe('Example Construction Ltd');
    expect(brandView(base).palette.accent).toBe('#1F3FA8');
    expect(brandView({ ...base, brandColorHex: '#0f766e' }).palette.accent).toBe('#0F766E');
    expect(brandView({ ...base, brandColorHex: 'red' }).palette.accent).toBe('#1F3FA8');
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
