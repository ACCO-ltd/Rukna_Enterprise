import {
  ENABLED_NOTIFICATION_EVENTS,
  isEnabledNotificationEvent,
  NOTIFICATION_DELIVERY_POLICY_CONFIGURED,
} from './notification-event.policy.js';

describe('notification event policy', () => {
  it('enables only the six NT-01 events', () => {
    expect(ENABLED_NOTIFICATION_EVENTS).toHaveLength(6);
    expect(isEnabledNotificationEvent('APPROVAL_ASSIGNED')).toBe(true);
    expect(isEnabledNotificationEvent('PURCHASE_ORDER_APPROVED')).toBe(false);
    expect(NOTIFICATION_DELIVERY_POLICY_CONFIGURED).toBe(false);
  });
});
