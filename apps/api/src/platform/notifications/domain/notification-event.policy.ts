export const ENABLED_NOTIFICATION_EVENTS = [
  'APPROVAL_ASSIGNED',
  'RECORD_RETURNED_FOR_REVISION',
  'RECORD_REJECTED',
  'PROJECT_SUSPENDED',
  'CONTRACT_OR_GUARANTEE_EXPIRY_WARNING',
  'CLIENT_INVOICE_OVERDUE',
] as const;

export type EnabledNotificationEvent = (typeof ENABLED_NOTIFICATION_EVENTS)[number];

export function isEnabledNotificationEvent(value: string): value is EnabledNotificationEvent {
  return (ENABLED_NOTIFICATION_EVENTS as readonly string[]).includes(value);
}

// NT-02 through NT-07 are deliberately not defaulted.
export const NOTIFICATION_DELIVERY_POLICY_CONFIGURED = false;
