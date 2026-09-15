import { describe, expect, it } from 'vitest';
import type { NotificationItem } from '@erp/types';

import { notificationCopy, notificationTone } from './presentation';

function item(overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: 'n-1',
    kind: 'STAGE_PAYMENT_DUE',
    severity: 'INFO',
    projectId: 'p-1',
    contractId: 'c-1',
    resourceType: 'ContractPaymentInstallment',
    resourceId: 'inst-1',
    contextData: { stageName: 'Structure', contractNumber: 'CT-001', dueInDays: 5 },
    actionUrl: '/projects/p-1/commercial/payment-schedule',
    readAt: null,
    createdAt: '2026-09-10T00:00:00.000Z',
    ...overrides,
  };
}

describe('notificationTone — severity chooses the colour, nothing else does', () => {
  it('maps URGENT to danger, WARNING to warning, INFO to info', () => {
    expect(notificationTone('URGENT')).toBe('danger');
    expect(notificationTone('WARNING')).toBe('warning');
    expect(notificationTone('INFO')).toBe('info');
  });
});

describe('notificationCopy — the wire kind becomes a localizable key + values', () => {
  it('derives the title/impact keys from the kind and passes contextData through as values', () => {
    expect(notificationCopy(item({ kind: 'STAGE_PAYMENT_OVERDUE' }))).toEqual({
      titleKey: 'STAGE_PAYMENT_OVERDUE.title',
      impactKey: 'STAGE_PAYMENT_OVERDUE.impact',
      values: { stageName: 'Structure', contractNumber: 'CT-001', dueInDays: 5 },
    });
  });

  it('carries the invoice-overdue values verbatim for that kind', () => {
    expect(
      notificationCopy(
        item({
          kind: 'CLIENT_INVOICE_OVERDUE',
          contextData: { invoiceNumber: 'INV-0007', daysOverdue: 12 },
        }),
      ),
    ).toEqual({
      titleKey: 'CLIENT_INVOICE_OVERDUE.title',
      impactKey: 'CLIENT_INVOICE_OVERDUE.impact',
      values: { invoiceNumber: 'INV-0007', daysOverdue: 12 },
    });
  });

  it('yields an empty value bag when contextData is null, never null', () => {
    expect(notificationCopy(item({ contextData: null })).values).toEqual({});
  });
});
