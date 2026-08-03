/**
 * Display formatting for money, quantities and dates.
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

/** Formats a count or quantity. Never used to derive a monetary total. */
export function formatNumber(
  value: string | number | null | undefined,
  locale: Locale = 'en',
): string | null {
  if (value === null || value === undefined || value === '') return null;

  const amount = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(amount)) return null;

  return new Intl.NumberFormat(numericLocale(locale)).format(amount);
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
