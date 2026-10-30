import { Injectable } from '@nestjs/common';
import { Document, Page, Text, renderToBuffer } from '@react-pdf/renderer';
import type { RequestIdentity, SupplierStatement } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { PlatformFileService } from '../../../../platform/files/application/platform-file.service.js';
import { resolveInvoiceDocumentSnapshot } from '../../accounting-core/infrastructure/invoice-document-policy.repository.js';
import {
  brandView,
  buildKitStyles,
  divider,
  documentFooter,
  documentHeader,
  footerColumns,
  formatAmount,
  formatDate,
  formatMoney,
  h,
  infoColumns,
  pageNumbers,
  topBar,
  totalsBlock,
  type FooterContactsInput,
  type KeyValue,
  type OrgIdentityInput,
} from '../../accounts-receivable/application/document-pdf/pdf-kit.js';
import { statementTable } from '../../accounts-receivable/application/statement-document.service.js';
import { SupplierStatementRepository } from '../infrastructure/supplier-statement.repository.js';
import { SupplierStatementService } from './supplier-statement.service.js';

/**
 * SS-2 — our record of a supplier's account as a branded PDF, to send them so the two sides can
 * agree: the bills still owed, the period's activity, and what our books show as owed. Drawn with
 * the organisation's logo, colour and footer (the invoice settings), on request; nothing is stored.
 */
export const SUPPLIER_STATEMENT_TEMPLATE_VERSION = 'supplier-statement-template-v1';

/** `Supplier-statement-SUP-BCS-2026-10-30.pdf` — the attachment name the supplier sees. */
export function supplierStatementPdfFilename(statement: Pick<SupplierStatement, 'supplier' | 'to'>): string {
  const who = (statement.supplier.code || statement.supplier.name).replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-|-$/g, '');
  return `Supplier-statement-${who}-${statement.to}.pdf`;
}

const KIND: Record<string, string> = {
  BILL: 'Bill',
  BILL_REVERSAL: 'Bill reversed',
  PAYMENT: 'Payment',
  PAYMENT_REVERSAL: 'Payment reversed',
  BUYER_CASH: 'Paid in cash',
  BUYER_CASH_REVERSAL: 'Cash payment reversed',
  DEBIT_NOTE: 'Debit note',
  DEBIT_NOTE_REVERSAL: 'Debit note reversed',
  REFUND: 'Refund received',
  REFUND_REVERSAL: 'Refund reversed',
};

export interface SupplierStatementDocumentInput {
  statement: SupplierStatement;
  org: OrgIdentityInput;
  footer?: FooterContactsInput | null;
}

/** Exported for the unit test, which walks the element tree for its text. */
export function SupplierStatementDocument({ input }: { input: SupplierStatementDocumentInput }) {
  const { statement: st } = input;
  const brand = brandView(input.org);
  const s = buildKitStyles(brand.palette, brand.compact);
  const usd = (value: string) => formatMoney(value, 'USD');
  const amt = (value: string | null) => (value === null ? '' : formatAmount(value));
  const day = (iso: string) => formatDate(new Date(`${iso}T00:00:00.000Z`));
  const openTotal = st.openBills.reduce((sum, b) => sum + Math.round(Number(b.balance) * 100), 0) / 100;
  const meta: KeyValue[] = [
    { label: 'Statement Date', value: day(st.to) },
    ...(st.supplier.code ? [{ label: 'Account', value: st.supplier.code }] : []),
    { label: 'Period', value: `${day(st.from)} – ${day(st.to)}` },
    { label: 'Currency', value: 'USD' },
  ];
  // The totals add up: open bills less what was paid ahead. Payments on the way are a note beside them.
  const summary: KeyValue[] = [
    { label: 'Open bills', value: usd(openTotal.toFixed(2)) },
    ...(Number(st.unapplied) > 0 ? [{ label: 'Less paid in advance', value: `−${usd(st.unapplied)}` }] : []),
  ];
  const notes = Number(st.pendingPayments) > 0 ? [`Payments on the way: ${usd(st.pendingPayments)}`] : [];
  const sectionTitle = (title: string) => h(Text, { style: [s.sectionTitle, { marginTop: 6 }] }, title);

  const openRows = st.openBills.map((b) => [
    b.number,
    b.supplierInvoiceNumber,
    day(b.dueDate),
    amt(b.total),
    Number(b.settled) === 0 ? '—' : amt(b.settled),
    amt(b.balance),
    b.daysOverdue > 0 ? `${b.daysOverdue} day${b.daysOverdue === 1 ? '' : 's'}` : 'Not due',
  ]);
  const activityRows = [
    [day(st.from), 'Opening balance', '', '', '', amt(st.openingBalance)],
    ...st.lines.map((l) => [
      day(l.date),
      [KIND[l.kind] ?? l.kind, l.reference].filter(Boolean).join(' '),
      l.description ?? '',
      l.credit === null ? '' : amt(l.credit),
      l.debit === null ? '' : amt(l.debit),
      amt(l.balance),
    ]),
    [day(st.to), 'Owed at the end', '', amt(st.totals.credits), amt(st.totals.debits), amt(st.closingBalance)],
  ];

  return h(
    Document,
    {
      title: `Statement of account — ${st.supplier.name}`,
      author: input.org.name,
      creator: SUPPLIER_STATEMENT_TEMPLATE_VERSION,
      producer: SUPPLIER_STATEMENT_TEMPLATE_VERSION,
    },
    h(
      Page,
      { size: 'A4', style: s.page },
      topBar(s),
      documentHeader(s, brand, 'STATEMENT', meta),
      divider(s),
      infoColumns(
        s,
        { label: 'Supplier', name: st.supplier.name, lines: [st.supplier.address].filter((l): l is string => Boolean(l)) },
        { label: 'We Owe You', name: usd(st.closingBalance), lines: [...summary.map((r) => `${r.label}: ${r.value}`), ...notes] },
      ),

      sectionTitle('Open bills'),
      openRows.length > 0
        ? statementTable(
            s,
            [
              { label: 'Bill', width: 70 },
              { label: 'Your invoice' },
              { label: 'Due', width: 62 },
              { label: 'Total', width: 64, align: 'right' },
              { label: 'Paid / credited', width: 64, align: 'right' },
              { label: 'Balance', width: 64, align: 'right' },
              { label: 'Overdue', width: 50 },
            ],
            openRows,
          )
        : h(Text, { style: [s.small, { marginBottom: 14 }] }, 'Nothing is owed: every bill is paid.'),

      totalsBlock(s, summary, { label: 'We Owe You', value: usd(st.closingBalance) }),

      sectionTitle(`Activity ${day(st.from)} – ${day(st.to)}`),
      statementTable(
        s,
        [
          { label: 'Date', width: 62 },
          { label: 'Document', width: 110 },
          { label: 'Details' },
          { label: 'Billed', width: 64, align: 'right' },
          { label: 'Paid', width: 64, align: 'right' },
          { label: 'Owed', width: 68, align: 'right' },
        ],
        activityRows,
        (row) => row === 0 || row === activityRows.length - 1,
      ),

      documentFooter(s, brand, footerColumns(input.footer, input.org.legalAddress)),
      pageNumbers(s),
    ),
  );
}

@Injectable()
export class SupplierStatementDocumentService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly statements: SupplierStatementService,
    private readonly repo: SupplierStatementRepository,
    private readonly files: PlatformFileService,
  ) {}

  async render(
    identity: RequestIdentity,
    supplierId: string,
    from?: string,
    to?: string,
  ): Promise<{ bytes: Buffer; filename: string; mimeType: string; statement: SupplierStatement }> {
    const statement = await this.statements.statement(identity, supplierId, from, to);
    const prisma = this.tenancy.getClient() as never;
    const org = await this.repo.findBranding(prisma, identity.activeOrganizationId);
    const [logo, settings] = await Promise.all([
      this.files.readBytesForRendering(org?.logoFileId ?? null),
      resolveInvoiceDocumentSnapshot(prisma, identity.activeOrganizationId),
    ]);
    const bytes = await renderToBuffer(
      SupplierStatementDocument({
        input: {
          statement,
          org: {
            name: org?.name ?? '',
            legalAddress: org?.legalAddress ?? null,
            taxRegistrationNumber: org?.taxRegistrationNumber ?? null,
            brandColorHex: org?.brandColorHex ?? null,
            template: org?.invoiceTemplate === 'COMPACT' ? 'COMPACT' : 'STANDARD',
            logo,
            tagline: settings?.tagline ?? null,
          },
          footer: settings?.footer ?? null,
        },
      }) as never,
    );
    return { bytes, filename: supplierStatementPdfFilename(statement), mimeType: 'application/pdf', statement };
  }
}
