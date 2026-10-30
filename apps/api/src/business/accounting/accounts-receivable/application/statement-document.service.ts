import { Injectable } from '@nestjs/common';
import { Document, Page, Text, View, renderToBuffer } from '@react-pdf/renderer';
import type { ClientStatement } from '@erp/types';

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
  type KitStyles,
  type OrgIdentityInput,
} from './document-pdf/pdf-kit.js';

/**
 * ST-6 — the branded statement of account the client receives (download, or WhatsApp): the
 * shared document kit's layout with the organisation's branding, and the same figures as the
 * statement page — the account by contract, the invoices still owed, and the period's activity.
 * Rendered on request, never stored as a record: a statement is a picture of a day, and the next
 * one is drawn fresh.
 */
export interface StatementDocumentInput {
  statement: ClientStatement;
  org: OrgIdentityInput;
  footer?: FooterContactsInput | null;
}

export const STATEMENT_TEMPLATE_VERSION = 'statement-template-v1';

/** `Statement-CLI-HRG-2026-10-30.pdf` — the attachment name the client sees. */
export function statementPdfFilename(statement: Pick<ClientStatement, 'client' | 'asOf'>): string {
  const who = (statement.client.code ?? statement.client.name).replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-|-$/g, '');
  return `Statement-${who}-${statement.asOf}.pdf`;
}

@Injectable()
export class StatementDocumentService {
  async render(input: StatementDocumentInput): Promise<Buffer> {
    return renderToBuffer(StatementDocument({ input }) as never);
  }
}

interface Column {
  label: string;
  /** A fixed width in points; the first column takes the rest. */
  width?: number;
  align?: 'right';
}

/** A ruled table in the kit's style; the header repeats on each page. */
function table(s: KitStyles, columns: Column[], rows: string[][], emphasis: (row: number) => boolean = () => false) {
  const cellStyle = (c: Column, i: number) => [
    s.cell,
    c.width ? { width: c.width } : { flex: 1 },
    i > 0 ? s.ruledCell : {},
    c.align ? { textAlign: c.align } : {},
  ];
  return h(
    View,
    { style: s.table },
    h(View, { style: s.thRow, fixed: true }, ...columns.map((c, i) => h(Text, { style: [...cellStyle(c, i), s.th, { fontSize: 7.5 }], key: `h${i}` }, c.label))),
    ...rows.map((row, r) =>
      h(
        View,
        { style: r === rows.length - 1 ? s.trLast : s.tr, wrap: false, key: `r${r}` },
        ...row.map((value, i) =>
          h(Text, { style: [...cellStyle(columns[i]!, i), emphasis(r) ? s.lineTitle : s.td, { fontSize: 8 }], key: `c${i}` }, value),
        ),
      ),
    ),
  );
}

const KIND: Record<string, string> = {
  INVOICE: 'Invoice',
  INVOICE_REVERSAL: 'Invoice reversed',
  CREDIT_NOTE: 'Credit note',
  CREDIT_NOTE_REVERSAL: 'Credit note reversed',
  RECEIPT: 'Payment',
  RECEIPT_REVERSAL: 'Payment reversed',
  WRITE_OFF: 'Written off',
  WRITE_OFF_REVERSAL: 'Write-off reversed',
  REFUND: 'Refund paid',
  REFUND_REVERSAL: 'Refund reversed',
};

/** Exported for the unit test, which walks the element tree for its text. */
export function StatementDocument({ input }: { input: StatementDocumentInput }) {
  const { statement: st } = input;
  const brand = brandView(input.org);
  const s = buildKitStyles(brand.palette, brand.compact);
  // Totals and the summary carry the currency; table cells are plain amounts (the header says USD)
  // so a six-figure amount stays on one line.
  const usd = (value: string | null) => (value === null ? '' : formatMoney(value, 'USD'));
  const amt = (value: string | null) => (value === null ? '' : formatAmount(value));
  const dash = (value: string | null) => (value === null || Number(value) === 0 ? '—' : amt(value));
  const day = (iso: string) => formatDate(new Date(`${iso}T00:00:00.000Z`));
  const owed = st.openInvoices.reduce((sum, i) => sum + Math.round(Number(i.balance) * 100), 0) / 100;
  const balanceDue = (owed - Number(st.onAccount)).toFixed(2);

  const meta: KeyValue[] = [
    { label: 'Statement Date', value: day(st.asOf) },
    ...(st.client.code ? [{ label: 'Account', value: st.client.code }] : []),
    { label: 'Period', value: `${day(st.from)} – ${day(st.to)}` },
    { label: 'Currency', value: 'USD' },
  ];

  const summary: KeyValue[] = [
    { label: 'Open invoices', value: usd(owed.toFixed(2)) },
    ...(Number(st.onAccount) > 0 ? [{ label: 'Less paid in advance', value: `−${usd(st.onAccount)}` }] : []),
    ...(Number(st.overdue) > 0 ? [{ label: 'Of which overdue', value: usd(st.overdue) }] : []),
    ...(Number(st.retentionHeld) > 0 ? [{ label: 'Retention held (due later)', value: usd(st.retentionHeld) }] : []),
  ];

  const sectionTitle = (title: string) => h(Text, { style: [s.sectionTitle, { marginTop: 6 }] }, title);

  const accountRows = st.accounts.map((a) => [
    a.kind === 'OTHER_SALES'
      ? 'Other sales'
      : [a.projectName ?? 'Project', a.contractNumber].filter(Boolean).join(' · '),
    a.contractValue ? amt(a.contractValue) : '—',
    a.billedToDate ? amt(a.billedToDate) : '—',
    amt(a.received),
    dash((Number(a.credited) + Number(a.writtenOff)).toFixed(2)),
    amt(a.balanceDue),
  ]);

  const openRows = st.openInvoices.map((i) => [
    i.invoiceNumber ?? '—',
    i.projectName || i.contractNumber ? [i.projectName, i.contractNumber].filter(Boolean).join(' · ') : (i.label ?? ''),
    i.dueDate ? day(i.dueDate) : '—',
    amt(i.total),
    dash((Number(i.received) + Number(i.adjusted)).toFixed(2)),
    amt(i.balance),
    i.daysOverdue > 0 ? `${i.daysOverdue} days` : 'Not due',
  ]);

  const activityRows = [
    [day(st.from), 'Opening balance', '', '', '', amt(st.openingBalance)],
    ...st.lines.map((l) => [
      day(l.date),
      [KIND[l.kind] ?? l.kind, l.reference].filter(Boolean).join(' '),
      l.description ?? '',
      l.debit === null ? '' : amt(l.debit),
      l.credit === null ? '' : amt(l.credit),
      amt(l.balance),
    ]),
    [day(st.to), 'Closing balance', '', amt(st.totals.debits), amt(st.totals.credits), amt(st.closingBalance)],
  ];

  return h(
    Document,
    {
      title: `Statement of account — ${st.client.name}`,
      author: input.org.name,
      creator: STATEMENT_TEMPLATE_VERSION,
      producer: STATEMENT_TEMPLATE_VERSION,
    },
    h(
      Page,
      { size: 'A4', style: s.page },
      topBar(s),
      documentHeader(s, brand, 'STATEMENT', meta),
      divider(s),
      infoColumns(
        s,
        { label: 'Statement For', name: st.client.name, lines: [st.client.address, st.client.taxNumber ? `Tax no. ${st.client.taxNumber}` : null].filter((l): l is string => Boolean(l)) },
        { label: 'Balance Due', name: usd(balanceDue), lines: summary.map((r) => `${r.label}: ${r.value}`) },
      ),

      accountRows.length > 0 ? sectionTitle('Account by project') : null,
      accountRows.length > 0
        ? table(
            s,
            [
              { label: 'Project / contract' },
              { label: 'Contract value', width: 78, align: 'right' },
              { label: 'Billed to date', width: 74, align: 'right' },
              { label: 'Received', width: 70, align: 'right' },
              { label: 'Credited', width: 58, align: 'right' },
              { label: 'Balance due', width: 74, align: 'right' },
            ],
            accountRows,
          )
        : null,

      sectionTitle('Open invoices'),
      openRows.length > 0
        ? table(
            s,
            [
              { label: 'Invoice', width: 74 },
              { label: 'For' },
              { label: 'Due', width: 62 },
              { label: 'Total', width: 64, align: 'right' },
              { label: 'Paid / credited', width: 64, align: 'right' },
              { label: 'Balance', width: 64, align: 'right' },
              { label: 'Overdue', width: 50 },
            ],
            openRows,
          )
        : h(Text, { style: [s.small, { marginBottom: 14 }] }, 'Nothing is owed: every invoice is paid.'),

      totalsBlock(s, summary, { label: 'Balance Due', value: usd(balanceDue) }),

      sectionTitle(`Activity ${day(st.from)} – ${day(st.to)}`),
      table(
        s,
        [
          { label: 'Date', width: 62 },
          { label: 'Document', width: 110 },
          { label: 'Details' },
          { label: 'Charged', width: 64, align: 'right' },
          { label: 'Paid', width: 64, align: 'right' },
          { label: 'Balance', width: 68, align: 'right' },
        ],
        activityRows,
        (row) => row === 0 || row === activityRows.length - 1,
      ),

      documentFooter(s, brand, footerColumns(input.footer, input.org.legalAddress)),
      pageNumbers(s),
    ),
  );
}
