import * as React from 'react';
import { Circle, Font, Image, Path, Rect, StyleSheet, Svg, Text, View } from '@react-pdf/renderer';

/**
 * Shared building blocks for the organisation's client-facing PDFs (the invoice and the payment
 * receipt), in the owner's minimal layout: a thin brand bar along the top, the logo + tagline +
 * address on the left and the big dark document title with its facts on the right, a two-column
 * info band, a lightly ruled table, a soft total box, and a footer contact strip (address /
 * phones / email + website, each behind a small line icon). One place draws the brand, so the two
 * documents cannot drift apart.
 *
 * Every helper is a plain function that RETURNS primitives rather than a React component: the
 * element tree stays made of primitives only, which is what the unit tests walk (under Jest
 * `@react-pdf/renderer` is a stub whose primitives render nothing).
 *
 * Written with `React.createElement` — `apps/api` has no JSX compiler setup.
 */

export const h = React.createElement;

// Never hyphenate: account numbers, references and amounts must print exactly as recorded. (A
// process-wide react-pdf setting; every document in this API wants it.)
Font.registerHyphenationCallback((word: string) => [word]);

/** The reference template's blue; an organisation's own brand colour replaces it. */
export const DEFAULT_ACCENT = '#1F3FA8';
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
/** A4 in points. */
export const A4_WIDTH = 595.28;
export const A4_HEIGHT = 841.89;
export const PAGE_MARGIN_X = 44;
/** Height reserved at the bottom of every page for the footer strip. */
const FOOTER_HEIGHT = 92;

export interface Palette {
  accent: string;
  /** Light tint of the accent, for the total box. */
  accentSoft: string;
  /** Dark navy for the document title and strong text. */
  navy: string;
  ink: string;
  muted: string;
  faint: string;
  border: string;
  /** Table header fill. */
  panel: string;
}

export function paletteFor(brandColorHex: string | null | undefined): Palette {
  const accent = HEX_COLOR.test(brandColorHex ?? '') ? (brandColorHex as string).toUpperCase() : DEFAULT_ACCENT;
  return {
    accent,
    accentSoft: mix(accent, '#FFFFFF', 0.92),
    navy: '#14213D',
    ink: '#1F2937',
    muted: '#6B7280',
    faint: '#9CA3AF',
    border: '#E2E6EC',
    panel: '#F4F6F9',
  };
}

/** Mix two #RRGGBB colours: 0 = `a`, 1 = `b`. */
function mix(a: string, b: string, amount: number): string {
  const channel = (i: number) => {
    const x = parseInt(a.slice(i, i + 2), 16);
    const y = parseInt(b.slice(i, i + 2), 16);
    return Math.round(x + (y - x) * amount)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(1)}${channel(3)}${channel(5)}`.toUpperCase();
}

/** The organisation identity every document carries, already reduced to printable values. */
export interface BrandView {
  orgName: string;
  /** `data:` URI of the logo, or null for a text wordmark. */
  logoSrc: string | null;
  /** Letter-spaced line under the logo, e.g. "CONSTRUCTION & DEVELOPMENT"; null for none. */
  tagline: string | null;
  addressLines: string[];
  /** "Tax Reg. 123", or null when the organisation has no tax number. */
  taxLine: string | null;
  palette: Palette;
  compact: boolean;
}

export interface OrgIdentityInput {
  name: string;
  legalAddress: string | null;
  taxRegistrationNumber: string | null;
  brandColorHex: string | null;
  template: 'STANDARD' | 'COMPACT';
  logo: { buffer: Buffer; mimeType: string } | null;
  /** From the invoice settings; optional. */
  tagline?: string | null;
}

export function brandView(org: OrgIdentityInput): BrandView {
  return {
    orgName: org.name,
    logoSrc: org.logo ? `data:${org.logo.mimeType};base64,${org.logo.buffer.toString('base64')}` : null,
    tagline: org.tagline?.trim() ? org.tagline.trim().toUpperCase() : null,
    addressLines: splitLines(org.legalAddress),
    taxLine: org.taxRegistrationNumber?.trim() ? `Tax Reg. ${org.taxRegistrationNumber.trim()}` : null,
    palette: paletteFor(org.brandColorHex),
    compact: org.template === 'COMPACT',
  };
}

/** The footer contact strip, as typed in the invoice settings. */
export interface FooterContactsInput {
  /** Null → the organisation's legal address. */
  address: string | null;
  phones: string[];
  email: string | null;
  website: string | null;
}

export type FooterIcon = 'pin' | 'phone' | 'mail';
export interface FooterColumn {
  icon: FooterIcon;
  lines: string[];
}

/** Longest footer line that fits its column; anything longer is cut with an ellipsis. */
export const FOOTER_LINE_MAX = 60;

/** `value` cut to `max` characters, ending in "…" when it was longer. */
export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

/**
 * The footer's columns — address (first two lines), phones (up to two), email + website — each
 * only when it has something to say. Lines are cut to fit (the settings validate the same limits;
 * this is the defence for older or legal-address values), so nothing overflows the strip.
 */
export function footerColumns(contacts: FooterContactsInput | null | undefined, legalAddress: string | null): FooterColumn[] {
  const fit = (line: string) => truncate(line, FOOTER_LINE_MAX);
  const address = splitLines(contacts?.address ?? legalAddress).slice(0, 2).map(fit);
  const phones = (contacts?.phones ?? []).map((p) => p.trim()).filter(Boolean).slice(0, 2).map(fit);
  const web = [contacts?.email, contacts?.website].map((v) => v?.trim() ?? '').filter(Boolean).map(fit);
  const columns: FooterColumn[] = [];
  if (address.length > 0) columns.push({ icon: 'pin', lines: address });
  if (phones.length > 0) columns.push({ icon: 'phone', lines: phones });
  if (web.length > 0) columns.push({ icon: 'mail', lines: web });
  return columns;
}

export interface KeyValue {
  label: string;
  value: string;
}

export type KitStyles = ReturnType<typeof buildKitStyles>;

export function buildKitStyles(p: Palette, compact: boolean) {
  return StyleSheet.create({
    page: {
      paddingTop: compact ? 44 : 52,
      paddingBottom: FOOTER_HEIGHT + 16,
      paddingHorizontal: PAGE_MARGIN_X,
      fontSize: 9,
      fontFamily: 'Helvetica',
      color: p.ink,
      lineHeight: 1.4,
    },
    topBar: { position: 'absolute', top: 24, left: PAGE_MARGIN_X, right: PAGE_MARGIN_X, height: 3, backgroundColor: p.accent },
    // Header
    headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
    headerLeft: { flexDirection: 'column', width: '56%' },
    headerRight: { flexDirection: 'column', alignItems: 'flex-end', width: '44%' },
    logo: { height: compact ? 28 : 32, maxWidth: 200, objectFit: 'contain', objectPosition: 'left' },
    wordmark: { fontSize: compact ? 19 : 22, lineHeight: 1.1, fontFamily: 'Helvetica-Bold', color: p.accent },
    tagline: { fontSize: 6.5, letterSpacing: 1.8, color: p.muted, marginTop: 5 },
    addressBlock: { marginTop: 12 },
    small: { fontSize: 8.5, color: p.muted, lineHeight: 1.5 },
    docTitle: {
      fontSize: compact ? 22 : 25.5,
      lineHeight: 1.05,
      fontFamily: 'Helvetica-Bold',
      color: p.navy,
      letterSpacing: 1.5,
      marginBottom: 14,
    },
    metaRow: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 4 },
    metaLabel: { fontSize: 8.5, color: p.muted, width: 84, textAlign: 'right', marginRight: 14 },
    metaValue: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: p.navy, width: 82, textAlign: 'right' },
    divider: { borderBottomWidth: 0.75, borderBottomColor: p.border, marginTop: compact ? 18 : 24, marginBottom: compact ? 16 : 20 },
    // Two-column info band
    infoRow: { flexDirection: 'row', marginBottom: compact ? 18 : 24 },
    infoColumn: { flex: 1, paddingRight: 16 },
    infoColumnRight: { flex: 1, paddingLeft: 20, borderLeftWidth: 0.75, borderLeftColor: p.border },
    infoLabel: { fontSize: 8.5, color: p.muted, marginBottom: 5 },
    infoName: { fontSize: 10.5, fontFamily: 'Helvetica-Bold', color: p.navy, marginBottom: 2 },
    // Table
    table: { borderWidth: 0.75, borderColor: p.border, borderRadius: 3, marginBottom: 14 },
    th: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: p.ink },
    thRow: {
      flexDirection: 'row',
      backgroundColor: p.panel,
      borderBottomWidth: 0.75,
      borderBottomColor: p.border,
    },
    tr: { flexDirection: 'row', borderBottomWidth: 0.75, borderBottomColor: p.border },
    trLast: { flexDirection: 'row' },
    cell: { paddingVertical: compact ? 6 : 8, paddingHorizontal: 8 },
    /** The thin vertical rule before the Amount column. */
    ruledCell: { borderLeftWidth: 0.75, borderLeftColor: p.border },
    td: { fontSize: 9 },
    lineTitle: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: p.navy },
    lineDetail: { fontSize: 8, color: p.muted, marginTop: 2 },
    // Totals
    totals: {
      alignSelf: 'flex-end',
      width: 236,
      marginBottom: compact ? 18 : 26,
      borderTopWidth: 0.75,
      borderTopColor: p.border,
      paddingTop: 6,
    },
    totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, paddingHorizontal: 10 },
    totalLabel: { fontSize: 9, color: p.muted },
    totalValue: { fontSize: 9, color: p.ink },
    totalDue: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: 6,
      paddingVertical: 8,
      paddingHorizontal: 10,
      backgroundColor: p.accentSoft,
      borderRadius: 4,
    },
    totalDueText: { fontSize: 10.5, fontFamily: 'Helvetica-Bold', color: p.accent },
    // Optional minimal sections
    sectionTitle: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: p.navy, marginBottom: 5 },
    // Signature
    signature: { width: 200, marginTop: 30 },
    signatureLine: { borderBottomWidth: 0.75, borderBottomColor: p.ink, marginBottom: 6 },
    signatureName: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: p.navy },
    signatureMeta: { fontSize: 8.5, color: p.muted },
    // Footer strip (fixed on every page)
    footer: { position: 'absolute', left: PAGE_MARGIN_X, right: PAGE_MARGIN_X, bottom: 0, height: FOOTER_HEIGHT },
    footerRule: { borderTopWidth: 0.75, borderTopColor: p.border },
    footerRow: { flexDirection: 'row', paddingTop: 16 },
    footerColumn: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingRight: 12 },
    footerColumnRuled: { borderLeftWidth: 0.75, borderLeftColor: p.border, paddingLeft: 14 },
    footerIcon: { width: 12, height: 12, marginRight: 8 },
    footerText: { fontSize: 8, color: p.muted, lineHeight: 1.5, textOverflow: 'ellipsis' },
    pageNumber: {
      position: 'absolute',
      left: PAGE_MARGIN_X,
      right: PAGE_MARGIN_X,
      // Placed from the top: react-pdf drops a dynamic (`render`) text anchored with `bottom`.
      top: A4_HEIGHT - 22,
      fontSize: 7,
      color: p.faint,
      textAlign: 'right',
    },
  });
}

/** The thin brand bar across the top edge of every page. */
export function topBar(s: KitStyles) {
  return h(View, { style: s.topBar, fixed: true });
}

/** Logo (or the name as a wordmark) + tagline + address on the left; title and facts on the right. */
export function documentHeader(s: KitStyles, brand: BrandView, title: string, meta: KeyValue[]) {
  return h(
    View,
    { style: s.headerRow },
    h(
      View,
      { style: s.headerLeft },
      brand.logoSrc ? h(Image, { style: s.logo, src: brand.logoSrc }) : h(Text, { style: s.wordmark }, brand.orgName),
      brand.tagline ? h(Text, { style: s.tagline }, brand.tagline) : null,
      brand.addressLines.length > 0 || brand.taxLine
        ? h(
            View,
            { style: s.addressBlock },
            ...brand.addressLines.map((line, i) => h(Text, { style: s.small, key: `addr${i}` }, line)),
            brand.taxLine ? h(Text, { style: s.small }, brand.taxLine) : null,
          )
        : null,
    ),
    h(
      View,
      { style: s.headerRight },
      h(Text, { style: s.docTitle }, title),
      ...meta.map((row, i) =>
        h(
          View,
          { style: s.metaRow, key: `meta${i}` },
          h(Text, { style: s.metaLabel }, row.label),
          h(Text, { style: s.metaValue }, row.value),
        ),
      ),
    ),
  );
}

export function divider(s: KitStyles) {
  return h(View, { style: s.divider });
}

export interface InfoColumn {
  label: string;
  /** Bold first line. */
  name: string;
  lines: string[];
}

/** Two columns split by a thin vertical rule ("Bill To" | "Project", "Received From" | "Payment"). */
export function infoColumns(s: KitStyles, left: InfoColumn, right: InfoColumn | null) {
  const column = (info: InfoColumn, style: object) =>
    h(
      View,
      { style },
      h(Text, { style: s.infoLabel }, info.label),
      h(Text, { style: s.infoName }, info.name),
      ...info.lines.map((line, i) => h(Text, { style: s.small, key: `l${i}` }, line)),
    );
  return h(
    View,
    { style: s.infoRow },
    column(left, s.infoColumn),
    right ? column(right, s.infoColumnRight) : h(View, { style: s.infoColumn }),
  );
}

/** Totals on the right; the last row in the soft accent box. */
export function totalsBlock(s: KitStyles, rows: KeyValue[], total: KeyValue) {
  return h(
    View,
    { style: s.totals, wrap: false },
    ...rows.map((row, i) =>
      h(
        View,
        { style: s.totalRow, key: `t${i}` },
        h(Text, { style: s.totalLabel }, row.label),
        h(Text, { style: s.totalValue }, row.value),
      ),
    ),
    h(
      View,
      { style: s.totalDue },
      h(Text, { style: s.totalDueText }, total.label),
      h(Text, { style: s.totalDueText }, total.value),
    ),
  );
}

/** A small line icon (24×24 viewBox, stroked in the accent colour). */
export function lineIcon(s: KitStyles, icon: FooterIcon, color: string) {
  const stroke = { stroke: color, strokeWidth: 1.8, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' };
  const shapes =
    icon === 'pin'
      ? [
          h(Path, { key: 'p', d: 'M12 22s7-7.4 7-12.5A7 7 0 0 0 5 9.5C5 14.6 12 22 12 22z', ...stroke }),
          h(Circle, { key: 'c', cx: 12, cy: 9.5, r: 2.6, ...stroke }),
        ]
      : icon === 'phone'
        ? [
            h(Path, {
              key: 'p',
              d: 'M21 16.5v3a2 2 0 0 1-2.2 2A19 19 0 0 1 2.5 5.2 2 2 0 0 1 4.5 3h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.4 10.8a16 16 0 0 0 4.8 4.8l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z',
              ...stroke,
            }),
          ]
        : [
            h(Rect, { key: 'r', x: 2.5, y: 5, width: 19, height: 14, rx: 2, ...stroke }),
            h(Path, { key: 'p', d: 'M3 6.5l9 6.5 9-6.5', ...stroke }),
          ];
  return h(Svg, { style: s.footerIcon, viewBox: '0 0 24 24' }, ...shapes);
}

/** Full-width rule, then the contact columns split by thin vertical rules; on every page. */
export function documentFooter(s: KitStyles, brand: BrandView, columns: FooterColumn[]) {
  return h(
    View,
    { style: s.footer, fixed: true },
    h(View, { style: s.footerRule }),
    columns.length > 0
      ? h(
          View,
          { style: s.footerRow },
          ...columns.map((column, i) =>
            h(
              View,
              { style: i === 0 ? s.footerColumn : [s.footerColumn, s.footerColumnRuled], key: `f${i}` },
              lineIcon(s, column.icon, brand.palette.navy),
              h(
                View,
                { style: { flex: 1 } },
                ...column.lines.map((line, j) =>
                  h(Text, { style: s.footerText, maxLines: 1, key: `fl${j}` }, line),
                ),
              ),
            ),
          ),
        )
      : null,
  );
}

/** "Page 2 of 3" in the footer, on documents longer than one page. */
export function pageNumbers(s: KitStyles) {
  return h(Text, {
    style: s.pageNumber,
    fixed: true,
    render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) =>
      totalPages > 1 ? `Page ${pageNumber} of ${totalPages}` : '',
  });
}

// ─── Formatting ────────────────────────────────────────────────────────────────

export function splitLines(value: string | null | undefined): string[] {
  return (value ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** "Oct 4, 2026" — dates are calendar dates (@db.Date), so read in UTC. */
export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

/** "412,500.00" — grouped, always 2dp. Non-numeric input is returned as given. */
export function formatAmount(value: string): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return value;
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
}

/** "USD 412,500.00"; a negative amount reads "USD -1,000.00". */
export function formatMoney(value: string, currencyCode: string): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return `${value} ${currencyCode}`;
  return `${currencyCode} ${formatAmount(value)}`;
}

/** 'SO' → 'Somalia'; an unknown code is returned as given. */
export function countryName(code: string | null | undefined): string | null {
  const trimmed = code?.trim();
  if (!trimmed) return null;
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(trimmed.toUpperCase()) ?? trimmed;
  } catch {
    return trimmed;
  }
}
