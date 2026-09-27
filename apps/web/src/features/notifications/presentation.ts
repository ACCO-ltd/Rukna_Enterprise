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
  return {
    titleKey: `${item.kind}.title`,
    impactKey: `${item.kind}.impact`,
    // next-intl needs a defined value per placeholder; a null contextData becomes an empty bag.
    values: item.contextData ?? {},
  };
}
