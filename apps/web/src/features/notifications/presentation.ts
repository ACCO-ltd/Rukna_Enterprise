import type { BadgeTone } from '@erp/ui';
import type { NotificationItem, NotificationSeverity } from '@erp/types';

/**
 * Pure presentation policy for the notification center (ADR-031). Kept out of the components so the
 * mapping from a server verdict to a tone and to an i18n string is unit-testable — the same reason
 * the commercial workspace keeps its tone mapping pure.
 */

/**
 * A notification's severity → badge tone. Severity is the server's judgement of urgency; the UI
 * only colours it. URGENT is the one that must read as red; a WARNING is amber; INFO is quiet.
 */
export function notificationTone(severity: NotificationSeverity): BadgeTone {
  switch (severity) {
    case 'URGENT':
      return 'danger';
    case 'WARNING':
      return 'warning';
    case 'INFO':
    default:
      return 'info';
  }
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
  return {
    titleKey: `${item.kind}.title`,
    impactKey: `${item.kind}.impact`,
    // next-intl needs a defined value per placeholder; a null contextData becomes an empty bag.
    values: item.contextData ?? {},
  };
}
