import * as React from 'react';
import { Font, Image, StyleSheet, Text, View } from '@react-pdf/renderer';

/**
 * Shared building blocks for the organisation's client-facing PDFs (the invoice and the payment
 * receipt): palette, base styles, the branded header, the page footer and the small cards both
 * documents use. One place draws the brand, so the two documents cannot drift apart.
 *
 * Every helper is a plain function that RETURNS primitives (`View` / `Text` / `Image`) rather than
 * a React component: the element tree stays made of primitives only, which is what the unit tests
 * walk (under Jest `@react-pdf/renderer` is a stub whose primitives render nothing).
 *
 * Written with `React.createElement` — `apps/api` has no JSX compiler setup.
 */

export const h = React.createElement;

// Never hyphenate: account names, references and amounts must print exactly as recorded. (A
// process-wide react-pdf setting; every document in this API wants it.)
Font.registerHyphenationCallback((word: string) => [word]);

/** The reference template's navy-blue accent; an organisation's own brand colour replaces it. */
export const DEFAULT_ACCENT = '#1F3FA8';
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
/** A4 page height in points. */
const A4_HEIGHT = 841.89;

export interface Palette {
  accent: string;
  /** Light tint of the accent, for the emphasised "amount due" box. */
  accentSoft: string;
  ink: string;
  muted: string;
  faint: string;
  border: string;
  panel: string;
}

export function paletteFor(brandColorHex: string | null | undefined): Palette {
  const accent = HEX_COLOR.test(brandColorHex ?? '') ? (brandColorHex as string).toUpperCase() : DEFAULT_ACCENT;
  return {
    accent,
    accentSoft: tint(accent, 0.92),
    ink: '#1A1F36',
    muted: '#5B6475',
    faint: '#8A93A3',
    border: '#DDE2EA',
    panel: '#F6F8FB',
  };
}

/** Mix a #RRGGBB colour toward white by `amount` (0 = unchanged, 1 = white). */
function tint(hex: string, amount: number): string {
  const channel = (i: number) => {
    const value = parseInt(hex.slice(i, i + 2), 16);
    return Math.round(value + (255 - value) * amount)
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
  addressLines: string[];
  /** "Tax Reg. 123", or null when the organisation has no tax number. */
  taxLine: string | null;
  /** "<Company> · <last address line>" for the page footer. */
  footerLine: string;
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
}

export function brandView(org: OrgIdentityInput): BrandView {
  const addressLines = splitLines(org.legalAddress);
  const locality = addressLines.length > 0 ? addressLines[addressLines.length - 1] : null;
  return {
    orgName: org.name,
    logoSrc: org.logo ? `data:${org.logo.mimeType};base64,${org.logo.buffer.toString('base64')}` : null,
    addressLines,
    taxLine: org.taxRegistrationNumber?.trim() ? `Tax Reg. ${org.taxRegistrationNumber.trim()}` : null,
    footerLine: locality ? `${org.name} · ${locality}` : org.name,
    palette: paletteFor(org.brandColorHex),
    compact: org.template === 'COMPACT',
  };
}

export interface KeyValue {
  label: string;
  value: string;
}

export type KitStyles = ReturnType<typeof buildKitStyles>;

export function buildKitStyles(p: Palette, compact: boolean) {
  return StyleSheet.create({
    page: {
      paddingTop: compact ? 28 : 36,
      // Room for the fixed footer.
      paddingBottom: 72,
      paddingHorizontal: compact ? 32 : 40,
      fontSize: 9,
      fontFamily: 'Helvetica',
      color: p.ink,
      lineHeight: 1.35,
    },
    // Header
    headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
    headerLeft: { flexDirection: 'column', width: '55%' },
    headerRight: { flexDirection: 'column', alignItems: 'flex-end', width: '45%' },
    logo: { maxHeight: compact ? 34 : 44, maxWidth: 170, marginBottom: 8, objectFit: 'contain' },
    wordmark: {
      fontSize: compact ? 15 : 18,
      lineHeight: 1.15,
      fontFamily: 'Helvetica-Bold',
      color: p.accent,
      marginBottom: 6,
    },
    orgName: { fontSize: 10.5, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
    small: { fontSize: 8.5, color: p.muted },
    docTitle: {
      fontSize: compact ? 22 : 26,
      lineHeight: 1.1,
      fontFamily: 'Helvetica-Bold',
      color: p.accent,
      letterSpacing: 2,
      marginBottom: 10,
    },
    metaRow: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 3 },
    metaLabel: { fontSize: 8.5, color: p.muted, width: 80, textAlign: 'right', marginRight: 10 },
    metaValue: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', minWidth: 80, textAlign: 'right' },
    divider: { borderBottomWidth: 1, borderBottomColor: p.border, marginTop: compact ? 14 : 20, marginBottom: compact ? 14 : 18 },
    // Section labels + cards
    sectionLabel: {
      fontSize: 7.5,
      fontFamily: 'Helvetica-Bold',
      color: p.accent,
      letterSpacing: 1,
      marginBottom: 5,
    },
    strong: { fontSize: 10, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
    card: {
      borderWidth: 1,
      borderColor: p.border,
      borderRadius: 6,
      backgroundColor: p.panel,
      padding: 12,
    },
    cardTitle: { fontSize: 9.5, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
    cardSubtitle: { fontSize: 8, color: p.muted, marginBottom: 8 },
    kvRow: { flexDirection: 'row', marginBottom: 3 },
    kvLabel: { fontSize: 8.5, color: p.muted, width: 92 },
    kvValue: { fontSize: 8.5, flex: 1, fontFamily: 'Helvetica-Bold' },
    amountBox: {
      alignSelf: 'flex-start',
      borderWidth: 1,
      borderColor: tintBorder(p),
      borderRadius: 6,
      backgroundColor: p.accentSoft,
      paddingVertical: 12,
      paddingHorizontal: 14,
    },
    amountValue: { fontSize: compact ? 16 : 18, lineHeight: 1.15, fontFamily: 'Helvetica-Bold', color: p.accent, marginTop: 2 },
    // Footer (fixed on every page)
    footer: {
      position: 'absolute',
      left: compact ? 32 : 40,
      right: compact ? 32 : 40,
      bottom: 28,
      flexDirection: 'row',
      alignItems: 'flex-end',
    },
    footerRule: { flex: 1, borderBottomWidth: 1, borderBottomColor: p.border, marginRight: 16, marginBottom: 4 },
    footerRight: { flexDirection: 'column', alignItems: 'flex-end' },
    footerThanks: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: p.accent },
    footerSmall: { fontSize: 7.5, color: p.faint, marginTop: 1 },
    pageNumber: {
      position: 'absolute',
      left: compact ? 32 : 40,
      right: compact ? 32 : 40,
      // Placed from the top: react-pdf drops a dynamic (`render`) text anchored with `bottom`.
      top: A4_HEIGHT - 26,
      fontSize: 7,
      color: p.faint,
    },
  });
}

/** A shade between the soft fill and the accent, for the amount box outline. */
function tintBorder(p: Palette): string {
  return mix(p.accentSoft, p.accent, 0.25);
}

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

/** Org identity on the left; the document title and its key/value facts on the right. */
export function documentHeader(s: KitStyles, brand: BrandView, title: string, meta: KeyValue[]) {
  return h(
    View,
    { style: s.headerRow },
    h(
      View,
      { style: s.headerLeft },
      brand.logoSrc
        ? h(Image, { style: s.logo, src: brand.logoSrc })
        : null,
      // Without a logo the name itself is the wordmark; with one, the name sits under it.
      h(Text, { style: brand.logoSrc ? s.orgName : s.wordmark }, brand.orgName),
      ...brand.addressLines.map((line, i) => h(Text, { style: s.small, key: `addr${i}` }, line)),
      brand.taxLine ? h(Text, { style: s.small }, brand.taxLine) : null,
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

export function sectionLabel(s: KitStyles, label: string) {
  return h(Text, { style: s.sectionLabel }, label);
}

export function keyValueRows(s: KitStyles, rows: KeyValue[]) {
  return rows.map((row, i) =>
    h(
      View,
      { style: s.kvRow, key: `kv${i}` },
      h(Text, { style: s.kvLabel }, row.label),
      h(Text, { style: s.kvValue }, row.value),
    ),
  );
}

/** The emphasised light box with a label and a large accent-coloured amount. */
export function amountPanel(s: KitStyles, label: string, value: string, style?: object) {
  return h(
    View,
    { style: style ? [s.amountBox, style] : s.amountBox },
    h(Text, { style: s.sectionLabel }, label),
    h(Text, { style: s.amountValue }, value),
  );
}

/** Left rule, right "Thank you…" + the company line; repeated on every page. */
export function documentFooter(s: KitStyles, brand: BrandView, thanks: string) {
  return h(
    View,
    { style: s.footer, fixed: true },
    h(View, { style: s.footerRule }),
    h(
      View,
      { style: s.footerRight },
      h(Text, { style: s.footerThanks }, thanks),
      h(Text, { style: s.footerSmall }, brand.footerLine),
    ),
  );
}

/** "Page 2 of 3" under the footer, on documents longer than one page. */
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
