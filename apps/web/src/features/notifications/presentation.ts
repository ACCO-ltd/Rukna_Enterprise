import type { StatusTone } from '@erp/ui';
import type { NotificationItem, NotificationSeverity } from '@erp/types';

import { statusTone } from '@/lib/status-registry';

/**
 * Pure presentation policy for the notification center (ADR-031). Kept out of the components so the
 * mapping from a server verdict to a tone and to an i18n string is unit-testable — the same reason
 * the commercial workspace keeps its tone mapping pure.
 */

/**
 * A notification's severity → tone. Severity is the server's judgement of urgency; the UI only
 * colours it, through the status registry's `severity` vocabulary (ADR-034): URGENT reads as red,
 * WARNING as amber, INFO stays quiet.
 */
export function notificationTone(severity: NotificationSeverity): StatusTone {
  return statusTone(severity, 'severity');
}

/**
 * The i18n key + interpolation values for a notification's title and impact lines.
 *
 * The kind chooses the message pair (`notifications.<kind>.title` / `.impact`); `contextData` carries
 * the values those ICU strings interpolate (`stageName`, `contractNumber`, `dueInDays`, …). The
 * server never ships prose — this is the single place the wire kind becomes a localizable key, so a
 * component never hand-assembles a message from `contextData`.
 */
export interface NotificationCopy {
  titleKey: string;
  impactKey: string;
  values: Record<string, string | number>;
}

export function notificationCopy(item: NotificationItem): NotificationCopy {
  const values = item.contextData ?? {};
  return {
    titleKey: `${item.kind}.title`,
    impactKey: `${item.kind}.impact`,
    // next-intl needs a defined value per placeholder; a null contextData becomes an empty bag.
    values: QUOTATION_KINDS.has(item.kind) ? { ...QUOTATION_DEFAULTS, ...values } : values,
  };
}

/**
 * Competitive-quotation kinds (ADR-044 §10), written as each step happens rather than by the daily
 * generator. Their `contextData` is `{ number, mrNumber, projectName?, quoteCount, note? }` — never
 * an amount. The optional values default to `none`, which the ICU `select` in the catalogue
 * renders as nothing, so a request without a project or a note still reads cleanly.
 */
export const QUOTATION_NOTIFICATION_KINDS = ['QUOTES_READY', 'QUOTATION_AWARDED', 'ANOTHER_QUOTE_REQUESTED'] as const;
const QUOTATION_KINDS: ReadonlySet<string> = new Set(QUOTATION_NOTIFICATION_KINDS);
const QUOTATION_DEFAULTS: Record<string, string | number> = {
  number: '',
  mrNumber: '',
  projectName: 'none',
  quoteCount: 0,
  note: 'none',
};
