import { PERMISSIONS } from '@erp/types';

import {
  allowedClientCommands,
  clientAuditSummary,
  collectionStatus,
  daysPastDue,
  deactivationBlocker,
} from './client-rules';

const d = (iso: string) => new Date(iso);

describe('client rules', () => {
  it('daysPastDue counts whole UTC calendar days (same as the commercial D5 rule)', () => {
    expect(daysPastDue(d('2026-09-20'), d('2026-09-28T23:59:00Z'))).toBe(8);
    expect(daysPastDue(d('2026-09-28'), d('2026-09-28T00:01:00Z'))).toBe(0);
    expect(daysPastDue(d('2026-09-30'), d('2026-09-28T12:00:00Z'))).toBe(-2);
  });

  it('collectionStatus: OVERDUE after the due date, DUE_SOON within 7 days, else CURRENT', () => {
    const asOf = d('2026-10-02T10:00:00Z');
    expect(collectionStatus(d('2026-10-01'), asOf)).toBe('OVERDUE');
    expect(collectionStatus(d('2026-10-02'), asOf)).toBe('DUE_SOON');
    expect(collectionStatus(d('2026-10-09'), asOf)).toBe('DUE_SOON');
    expect(collectionStatus(d('2026-10-10'), asOf)).toBe('CURRENT');
    expect(collectionStatus(null, asOf)).toBe('CURRENT');
  });

  it('deactivationBlocker: projects first, then open balance', () => {
    expect(deactivationBlocker({ unfinishedProjectCount: 1, hasOpenBalance: true })).toBe('ACTIVE_PROJECTS');
    expect(deactivationBlocker({ unfinishedProjectCount: 0, hasOpenBalance: true })).toBe('OPEN_BALANCE');
    expect(deactivationBlocker({ unfinishedProjectCount: 0, hasOpenBalance: false })).toBeNull();
  });

  it('allowedClientCommands: permission + status + blocker', () => {
    const manage = [PERMISSIONS.clientsView, PERMISSIONS.clientsManage];
    expect(allowedClientCommands('ACTIVE', manage, null)).toEqual(['DEACTIVATE']);
    expect(allowedClientCommands('ACTIVE', manage, 'OPEN_BALANCE')).toEqual([]);
    expect(allowedClientCommands('INACTIVE', manage, null)).toEqual(['REACTIVATE']);
    expect(allowedClientCommands('ACTIVE', [PERMISSIONS.clientsView], null)).toEqual([]);
    expect(allowedClientCommands('INACTIVE', [PERMISSIONS.clientsView], null)).toEqual([]);
  });

  it('clientAuditSummary: one sentence per command, never an amount', () => {
    expect(clientAuditSummary('client.create', null, { name: 'Hormuud' }, null)).toBe('Created client Hormuud');
    expect(clientAuditSummary('client.update', { city: null }, { city: 'Hargeisa', paymentTermsDays: 30 }, null)).toBe(
      'Updated city, payment terms',
    );
    expect(clientAuditSummary('client.contact.add', null, { name: 'Ahmed' }, null)).toBe('Added contact Ahmed');
    expect(
      clientAuditSummary('client.contact.update', { phone: 'x', contactName: 'Ahmed' }, { phone: 'y', contactName: 'Ahmed' }, null),
    ).toBe('Updated contact Ahmed (phone)');
    expect(clientAuditSummary('client.contact.make-primary', null, { contactName: 'Hodan' }, null)).toBe(
      'Made Hodan the primary contact',
    );
    expect(clientAuditSummary('client.contact.remove', { name: 'Ahmed' }, null, null)).toBe('Removed contact Ahmed');
    expect(clientAuditSummary('client.deactivate', null, null, 'Duplicate record')).toBe('Deactivated — Duplicate record');
    expect(clientAuditSummary('client.reactivate', null, null, null)).toBe('Reactivated');
  });
});
