import { Injectable } from '@nestjs/common';
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';

import {
  amountPanel,
  buildKitStyles,
  divider,
  documentFooter,
  documentHeader,
  pageNumbers,
  h,
  keyValueRows,
  sectionLabel,
  type KitStyles,
  type Palette,
} from './document-pdf/pdf-kit.js';
import {
  INVOICE_TEMPLATE_VERSION,
  buildInvoiceViewModel,
  type InvoiceDocumentInput,
  type InvoiceViewModel,
} from './document-pdf/invoice-view-model.js';

export type {
  InvoiceDocumentInput,
  InvoiceDocumentLine,
  InvoicePaymentDetails,
  InvoiceSignatory,
} from './document-pdf/invoice-view-model.js';

/**
 * The branded client invoice PDF (A4) — header with the organisation's identity and the invoice
 * facts, Bill To / Project / Amount Due, the line table, totals, payment information and notes,
 * the authorised signature and the page footer. See
 * {@link ClientInvoiceService.getOrGenerateDocument} for when it runs: lazily, on first request,
 * then stored and IMMUTABLE — this layout only reaches documents generated after it shipped.
 *
 * What each section shows is decided by {@link buildInvoiceViewModel}; this file only lays it out.
 * The header, footer and cards are shared with the payment receipt (document-pdf/pdf-kit.ts).
 */
@Injectable()
export class InvoiceDocumentService {
  async render(input: InvoiceDocumentInput): Promise<Buffer> {
    return renderToBuffer(InvoiceDocument({ input }) as never);
  }
}

/** Exported for the unit test, which walks the element tree for its text. */
export function InvoiceDocument({ input }: { input: InvoiceDocumentInput }) {
  const vm = buildInvoiceViewModel(input);
  const { palette, compact } = vm.brand;
  const kit = buildKitStyles(palette, compact);
  const s = buildInvoiceStyles(palette, compact);

  return h(
    Document,
    {
      title: `Invoice ${input.invoiceNumber ?? 'draft'}`,
      author: vm.brand.orgName,
      creator: INVOICE_TEMPLATE_VERSION,
      producer: INVOICE_TEMPLATE_VERSION,
    },
    h(
      Page,
      { size: 'A4', style: kit.page },
      documentHeader(kit, vm.brand, vm.title, vm.meta),
      divider(kit),
      parties(kit, s, vm),
      lineTable(s, vm),
      h(
        // Totals, payment/notes and signature stay together rather than splitting across pages.
        View,
        { wrap: false },
        totals(s, vm),
        paymentAndNotes(kit, s, vm),
        signature(s, vm),
        vm.footerNote ? h(Text, { style: s.footerNote }, vm.footerNote) : null,
      ),
      documentFooter(kit, vm.brand, vm.thanks),
      pageNumbers(kit),
    ),
  );
}

function parties(kit: KitStyles, s: InvoiceStyles, vm: InvoiceViewModel) {
  return h(
    View,
    { style: s.partiesRow },
    h(
      View,
      { style: s.partyColumn },
      sectionLabel(kit, 'BILL TO'),
      h(Text, { style: kit.strong }, vm.billTo.name),
      ...vm.billTo.lines.map((line, i) => h(Text, { style: kit.small, key: `bt${i}` }, line)),
      h(Text, { style: kit.small }, vm.billTo.taxLine),
    ),
    h(
      View,
      { style: s.partyColumn },
      vm.project ? sectionLabel(kit, 'PROJECT') : null,
      vm.project ? h(Text, { style: kit.strong }, vm.project.code) : null,
      vm.project ? h(Text, { style: kit.small }, vm.project.name) : null,
      vm.project?.location ? h(Text, { style: kit.small }, vm.project.location) : null,
    ),
    amountPanel(kit, vm.amountDue.label, vm.amountDue.value, s.amountColumn),
  );
}

function lineTable(s: InvoiceStyles, vm: InvoiceViewModel) {
  return h(
    View,
    { style: s.table },
    // `fixed` repeats the header row on every page the table continues onto.
    h(
      View,
      { style: s.tableHeader, fixed: true },
      h(Text, { style: [s.th, s.colIndex] }, vm.columns.index),
      h(Text, { style: [s.th, s.colDescription] }, vm.columns.description),
      h(Text, { style: [s.th, s.colQty] }, vm.columns.quantity),
      h(Text, { style: [s.th, s.colMoney] }, vm.columns.unitPrice),
      h(Text, { style: [s.th, s.colMoney] }, vm.columns.amount),
    ),
    ...vm.lines.map((line, i) =>
      h(
        View,
        { style: i === vm.lines.length - 1 ? [s.tr, s.trLast] : s.tr, wrap: false, key: `l${i}` },
        h(Text, { style: [s.td, s.colIndex, s.muted] }, line.index),
        h(
          View,
          { style: s.colDescription },
          h(Text, { style: s.lineTitle }, line.title),
          line.detail ? h(Text, { style: s.lineDetail }, line.detail) : null,
        ),
        h(Text, { style: [s.td, s.colQty] }, line.quantity),
        h(Text, { style: [s.td, s.colMoney] }, line.unitPrice),
        h(Text, { style: [s.td, s.colMoney, s.amountCell] }, line.amount),
      ),
    ),
  );
}

function totals(s: InvoiceStyles, vm: InvoiceViewModel) {
  return h(
    View,
    { style: s.totalsBox },
    ...vm.totals.map((row, i) =>
      h(
        View,
        { style: row.emphasis ? s.totalRowStrong : s.totalRow, key: `t${i}` },
        h(Text, { style: row.emphasis ? s.totalLabelStrong : s.totalLabel }, row.label),
        h(Text, { style: row.emphasis ? s.totalValueStrong : s.totalValue }, row.value),
      ),
    ),
  );
}

function paymentAndNotes(kit: KitStyles, s: InvoiceStyles, vm: InvoiceViewModel) {
  if (!vm.payment && vm.notes.length === 0) return null;
  return h(
    View,
    { style: s.cardsRow },
    vm.payment
      ? h(
          View,
          { style: [kit.card, s.cardHalf] },
          h(Text, { style: kit.cardTitle }, vm.payment.title),
          h(Text, { style: kit.cardSubtitle }, vm.payment.subtitle),
          ...keyValueRows(kit, vm.payment.rows),
        )
      : null,
    vm.notes.length > 0
      ? h(
          View,
          { style: [kit.card, s.cardHalf, vm.payment ? s.cardGap : {}] },
          h(Text, { style: [kit.cardTitle, s.notesTitle] }, 'Notes'),
          ...vm.notes.map((note, i) =>
            h(
              View,
              { style: s.noteRow, key: `n${i}` },
              h(Text, { style: s.noteNumber }, `${i + 1}.`),
              h(Text, { style: s.noteText }, note),
            ),
          ),
        )
      : null,
  );
}

function signature(s: InvoiceStyles, vm: InvoiceViewModel) {
  const sig = vm.signature;
  return h(
    View,
    { style: s.signatureBlock },
    h(Text, { style: s.signatureLabel }, 'AUTHORIZED SIGNATURE'),
    h(View, { style: s.signatureLine }),
    sig.name ? h(Text, { style: s.signatureName }, sig.name) : null,
    sig.name && sig.title ? h(Text, { style: s.signatureMeta }, sig.title) : null,
    sig.name ? h(Text, { style: s.signatureMeta }, sig.company) : null,
    sig.name ? h(Text, { style: s.signatureMeta }, `Date: ${sig.date}`) : null,
  );
}

type InvoiceStyles = ReturnType<typeof buildInvoiceStyles>;

function buildInvoiceStyles(p: Palette, compact: boolean) {
  const rowPad = compact ? 6 : 8;
  return StyleSheet.create({
    partiesRow: { flexDirection: 'row', marginBottom: compact ? 16 : 22 },
    partyColumn: { width: '33%', paddingRight: 14 },
    amountColumn: { width: '34%', justifyContent: 'center' },
    // Table
    table: { marginBottom: 12 },
    tableHeader: {
      flexDirection: 'row',
      backgroundColor: p.panel,
      borderTopWidth: 1,
      borderBottomWidth: 1,
      borderColor: p.border,
      paddingVertical: 6,
      paddingHorizontal: 6,
    },
    th: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: p.accent, letterSpacing: 0.6 },
    tr: {
      flexDirection: 'row',
      paddingVertical: rowPad,
      paddingHorizontal: 6,
      borderBottomWidth: 1,
      borderBottomColor: '#EDF0F4',
    },
    trLast: { borderBottomColor: p.border },
    td: { fontSize: 9 },
    muted: { color: p.faint },
    colIndex: { width: 22 },
    colDescription: { flex: 1, paddingRight: 10 },
    colQty: { width: 36, textAlign: 'right' },
    colMoney: { width: 92, textAlign: 'right' },
    amountCell: { fontFamily: 'Helvetica-Bold' },
    lineTitle: { fontSize: 9, fontFamily: 'Helvetica-Bold' },
    lineDetail: { fontSize: 8, color: p.muted, marginTop: 2 },
    // Totals
    totalsBox: { alignSelf: 'flex-end', width: 240, marginBottom: compact ? 14 : 20 },
    totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, paddingHorizontal: 6 },
    totalLabel: { fontSize: 9, color: p.muted },
    totalValue: { fontSize: 9 },
    totalRowStrong: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: 6,
      paddingVertical: 8,
      paddingHorizontal: 6,
      backgroundColor: p.accentSoft,
      borderRadius: 4,
    },
    totalLabelStrong: { fontSize: 10.5, fontFamily: 'Helvetica-Bold', color: p.accent },
    totalValueStrong: { fontSize: 10.5, fontFamily: 'Helvetica-Bold', color: p.accent },
    // Payment + notes
    cardsRow: { flexDirection: 'row', marginBottom: compact ? 16 : 24 },
    cardHalf: { flex: 1 },
    cardGap: { marginLeft: 12 },
    notesTitle: { marginBottom: 8 },
    noteRow: { flexDirection: 'row', marginBottom: 3 },
    noteNumber: { fontSize: 8.5, color: p.accent, fontFamily: 'Helvetica-Bold', width: 14 },
    noteText: { fontSize: 8.5, color: p.ink, flex: 1 },
    // Signature
    signatureBlock: { width: 220, marginTop: 4 },
    signatureLabel: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: p.accent, letterSpacing: 1, marginBottom: 28 },
    signatureLine: { borderBottomWidth: 1, borderBottomColor: p.ink, marginBottom: 5 },
    signatureName: { fontSize: 9.5, fontFamily: 'Helvetica-Bold' },
    signatureMeta: { fontSize: 8.5, color: p.muted },
    footerNote: { fontSize: 8, color: p.muted, marginTop: 14 },
  });
}
