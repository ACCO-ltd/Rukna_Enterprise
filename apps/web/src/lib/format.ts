/**
 * Display formatting for money, quantities, dates, relative time and status badges.
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

// ─── Status presentation ──────────────────────────────────────────────────────

/**
 * The six semantic display tokens for lifecycle states across the platform.
 * Components map these to Tailwind classes — never map status strings to colors directly.
 */
export type StatusToken =
  | 'NEUTRAL'      // draft, inactive — grey
  | 'IN_PROGRESS'  // moving through a workflow — blue
  | 'WARNING'      // needs attention, partial, at risk — yellow
  | 'SUCCESS'      // healthy, complete, paid — green
  | 'DANGER'       // stopped, failed, urgent — red
  | 'HISTORICAL';  // superseded, archived, no longer active — purple

export interface StatusPresentation {
  token: StatusToken;
  /**
   * True for terminal states that are resolved but not urgent (CLOSED, CANCELLED,
   * SUPERSEDED). Components render these as muted/ghost variants of their token.
   */
  muted: boolean;
}

/**
 * Global status → token mapping for statuses that have the same meaning regardless
 * of which entity carries them.
 */
const GLOBAL_STATUS_MAP: Record<string, StatusPresentation> = {
  // Neutral
  DRAFT:                       { token: 'NEUTRAL',     muted: false },
  INACTIVE:                    { token: 'NEUTRAL',     muted: false },
  PENDING:                     { token: 'NEUTRAL',     muted: false },

  // In progress
  UNDER_REVIEW:                { token: 'IN_PROGRESS', muted: false },
  PENDING_INTERNAL_APPROVAL:   { token: 'IN_PROGRESS', muted: false },
  APPROVED_FOR_SUBMISSION:     { token: 'IN_PROGRESS', muted: false },
  APPROVED:                    { token: 'IN_PROGRESS', muted: false },
  PENDING_SIGNATURE:           { token: 'IN_PROGRESS', muted: false },
  MOBILIZING:                  { token: 'IN_PROGRESS', muted: false },
  SUBMITTED:                   { token: 'IN_PROGRESS', muted: false },

  // Warning
  RETURNED_FOR_REVISION:       { token: 'WARNING',     muted: false },
  SUSPENDED:                   { token: 'WARNING',     muted: false },
  FINAL_ACCOUNT_PENDING:       { token: 'WARNING',     muted: false },
  PRACTICAL_COMPLETION:        { token: 'WARNING',     muted: false },
  CLOSEOUT:                    { token: 'WARNING',     muted: false },
  PARTIALLY_CERTIFIED:         { token: 'WARNING',     muted: false },
  PARTIALLY_PAID:              { token: 'WARNING',     muted: false },
  EXPIRING_SOON:               { token: 'WARNING',     muted: false },
  UNPAID:                      { token: 'WARNING',     muted: false },

  // Success
  ACTIVE:                      { token: 'SUCCESS',     muted: false },
  BASELINED:                   { token: 'SUCCESS',     muted: false },
  EXECUTED:                    { token: 'SUCCESS',     muted: false },
  CERTIFIED:                   { token: 'SUCCESS',     muted: false },
  PAID:                        { token: 'SUCCESS',     muted: false },
  COMPLETED:                   { token: 'SUCCESS',     muted: false },
  RELEASED:                    { token: 'SUCCESS',     muted: true  },
  CLOSED:                      { token: 'SUCCESS',     muted: true  },

  // Danger
  REJECTED:                    { token: 'DANGER',      muted: false },
  TERMINATED:                  { token: 'DANGER',      muted: true  },
  CANCELLED:                   { token: 'DANGER',      muted: true  },
  OVERDUE:                     { token: 'DANGER',      muted: false },
  EXPIRED:                     { token: 'DANGER',      muted: false },

  // Historical
  SUPERSEDED:                  { token: 'HISTORICAL',  muted: true  },
  ARCHIVED:                    { token: 'HISTORICAL',  muted: true  },
  REPLACED:                    { token: 'HISTORICAL',  muted: true  },
};

const FALLBACK: StatusPresentation = { token: 'NEUTRAL', muted: false };

/**
 * Resolves a status string to its platform display token.
 *
 * Pass `entityType` for context-sensitive overrides — e.g. a Project in APPROVED status
 * is still mobilizing (IN_PROGRESS), whereas the same string on a hypothetical future
 * entity might mean the work is complete (SUCCESS). The global map handles all Sprint 1–3
 * statuses correctly without overrides; add entity-specific entries here as new modules
 * introduce ambiguous status strings.
 */
export function formatStatus(status: string | null | undefined): StatusPresentation {
  if (!status) return FALLBACK;
  return GLOBAL_STATUS_MAP[status] ?? FALLBACK;
}
