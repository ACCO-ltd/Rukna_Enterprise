/**
 * Display formatting for money, quantities, dates and relative time.
 * Status tones live in `status-registry.ts`.
 *
 * MONEY POLICY — the frontend performs NO arithmetic on monetary values.
 *
 * The API returns Decimal columns as strings (`"4500000.00"`, `"1200.000"`) precisely so
 * they survive the trip without binary floating-point error. Parsing them into `number`
 * to add them up would reintroduce exactly the error the Decimal type exists to prevent,
 * and it would duplicate a money rule the server already owns. Totals therefore always
 * come from the server (`computedTotal` on the BOQ tree); these helpers parse only at the
 * final render step, where a float is harmless because the value is about to become text.
 *
 * DIGITS — Arabic renders with Western digits (`-u-nu-latn`). Gulf construction contracts
 * and payment certificates use Western numerals, so financial figures match the paperwork
 * they are reconciled against. This is a deliberate product decision, not a default.
 */

type Locale = 'en' | 'ar';

/** Forces Western digits in both locales. */
function numericLocale(locale: string): string {
  return locale.startsWith('ar') ? 'ar-u-nu-latn' : locale;
}

/**
 * Formats a monetary amount for display.
 *
 * Accepts the string the API sends. Returns null when there is no value, so callers can
 * decide how to present absence rather than being handed a misleading "0.00".
 */
export function formatMoney(
  value: string | number | null | undefined,
  currency: string | null | undefined,
  locale: Locale = 'en',
): string | null {
  if (value === null || value === undefined || value === '') return null;

  const amount = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(amount)) return null;

  // Currency is nullable on both projects and BOQ nodes. Without one, show a plain
  // decimal rather than inventing a symbol — an amount labelled with the wrong currency
  // is worse than an amount with none.
  if (!currency) {
    return new Intl.NumberFormat(numericLocale(locale), {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  }

  return new Intl.NumberFormat(numericLocale(locale), {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * A unit price: 2 decimals, or up to 4 when the price is not a whole cent — so 100 × $5.5666 reads
 * as $5.5666 each, not a rounded $5.57 that does not multiply back to the line amount.
 */
export function formatUnitPrice(
  value: string | number | null | undefined,
  currency: string | null | undefined,
  locale: Locale = 'en',
): string | null {
  if (value === null || value === undefined || value === '') return null;
  const amount = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(amount)) return null;
  return new Intl.NumberFormat(numericLocale(locale), {
    ...(currency ? { style: 'currency' as const, currency } : {}),
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(amount);
}

/**
 * Formats a count or quantity. Never used to derive a monetary total.
 *
 * `fractionDigits` pins the decimal places exactly. BOQ quantities are `Decimal(18,3)` and
 * quantity surveying convention shows all three, so `4250` reads as `4,250.000` — the
 * trailing zeros state the measurement precision rather than padding the number.
 */
export function formatNumber(
  value: string | number | null | undefined,
  locale: Locale = 'en',
  fractionDigits?: number,
): string | null {
  if (value === null || value === undefined || value === '') return null;

  const amount = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(amount)) return null;

  return new Intl.NumberFormat(
    numericLocale(locale),
    fractionDigits === undefined
      ? {}
      : { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits },
  ).format(amount);
}

/** Formats an ISO date string as a short calendar date. Returns null when absent. */
export function formatDate(
  value: string | null | undefined,
  locale: Locale = 'en',
): string | null {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat(numericLocale(locale), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    // Dates are stored as UTC calendar dates; formatting in local time would shift them
    // a day backwards for anyone west of UTC.
    timeZone: 'UTC',
  }).format(date);
}

/**
 * Formats an ISO timestamp as a human-readable relative time string.
 *
 * Uses `Intl.RelativeTimeFormat` so EN and AR output match platform locale conventions.
 * Returns null for absent or unparseable values — callers decide how to render absence.
 *
 * Thresholds mirror common product conventions:
 *   < 60 s  → "just now"
 *   < 1 h   → "X minutes ago" / "in X minutes"
 *   < 24 h  → "X hours ago"   / "in X hours"
 *   < 30 d  → "X days ago"    / "in X days"
 *   < 12 mo → "X months ago"  / "in X months"
 *   else    → "X years ago"   / "in X years"
 */
export function relativeTime(
  value: string | null | undefined,
  locale: Locale = 'en',
  now: Date = new Date(),
): string | null {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const diffSeconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const absSeconds = Math.abs(diffSeconds);

  const rtf = new Intl.RelativeTimeFormat(numericLocale(locale), { numeric: 'auto' });

  // Anything under 60 seconds collapses to "now" — showing exact seconds adds noise.
  if (absSeconds < 60) return rtf.format(0, 'second');
  if (absSeconds < 3600) return rtf.format(Math.round(diffSeconds / 60), 'minute');
  if (absSeconds < 86400) return rtf.format(Math.round(diffSeconds / 3600), 'hour');
  if (absSeconds < 2592000) return rtf.format(Math.round(diffSeconds / 86400), 'day');
  if (absSeconds < 31536000) return rtf.format(Math.round(diffSeconds / 2592000), 'month');
  return rtf.format(Math.round(diffSeconds / 31536000), 'year');
}

/**
 * A timestamp as "15 Sep 2026, 09:12", for activity and approval trails. Null for absent or
 * unparseable input, like its siblings.
 */
export function formatDateTime(value: string | null | undefined, locale: Locale = 'en'): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(numericLocale(locale), {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}
