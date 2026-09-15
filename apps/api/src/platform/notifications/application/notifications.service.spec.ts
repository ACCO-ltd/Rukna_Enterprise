import { NotFoundException } from '@nestjs/common';

import { NotificationsService } from './notifications.service.js';
import { NotificationEntity } from '../domain/notification.entity.js';
import type { INotificationRepository } from '../domain/notification-repository.interface.js';

const ORG = 'org_1';
const USER = 'user_1';

function makeRepo(): jest.Mocked<INotificationRepository> {
  return {
    upsertByDedupeKey: jest.fn(),
    autoResolveMissing: jest.fn(),
    findForRecipientPaged: jest.fn(),
    countUnread: jest.fn(),
    markRead: jest.fn(),
    markAllRead: jest.fn(),
  } as unknown as jest.Mocked<INotificationRepository>;
}

function entity(overrides: Partial<NotificationEntity> = {}): NotificationEntity {
  return new NotificationEntity(
    overrides.id ?? 'notif_1',
    overrides.organizationId ?? ORG,
    overrides.recipientUserId ?? USER,
    overrides.kind ?? 'STAGE_PAYMENT_DUE',
    overrides.severity ?? 'WARNING',
    overrides.dedupeKey ?? 'stage-due:inst_1',
    overrides.projectId ?? 'project_1',
    overrides.contractId ?? 'contract_1',
    overrides.resourceType ?? 'ContractPaymentInstallment',
    overrides.resourceId ?? 'inst_1',
    overrides.contextData ?? { stageName: 'Structure', dueInDays: 3 },
    overrides.actionUrl ?? '/projects/project_1/commercial/payment-schedule',
    overrides.readAt ?? null,
    overrides.resolvedAt ?? null,
    overrides.createdAt ?? new Date('2026-09-15T06:00:00.000Z'),
    overrides.updatedAt ?? new Date('2026-09-15T06:00:00.000Z'),
  );
}

describe('NotificationsService', () => {
  it('list scopes by (org, user), applies the unread filter, and reports unreadTotal independently of the page', async () => {
    const repo = makeRepo();
    repo.findForRecipientPaged.mockResolvedValue({ items: [entity()], total: 1 });
    repo.countUnread.mockResolvedValue(5);
    const service = new NotificationsService(repo);

    const result = await service.list(ORG, USER, { unread: true, page: 2, limit: 10 });

    expect(repo.findForRecipientPaged).toHaveBeenCalledWith(ORG, USER, {
      unread: true,
      page: 2,
      limit: 10,
    });
    expect(repo.countUnread).toHaveBeenCalledWith(ORG, USER);
    expect(result.page).toBe(2);
    expect(result.limit).toBe(10);
    expect(result.total).toBe(1);
    expect(result.unreadTotal).toBe(5);
    expect(result.items).toHaveLength(1);
  });

  it('list defaults page=1, limit=20 when omitted', async () => {
    const repo = makeRepo();
    repo.findForRecipientPaged.mockResolvedValue({ items: [], total: 0 });
    repo.countUnread.mockResolvedValue(0);
    const service = new NotificationsService(repo);

    const result = await service.list(ORG, USER, { unread: false });

    expect(repo.findForRecipientPaged).toHaveBeenCalledWith(ORG, USER, {
      unread: false,
      page: 1,
      limit: 20,
    });
    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
  });

  it('maps a row to the wire item: ISO dates, contextData passthrough, and NO resolvedAt field', async () => {
    const repo = makeRepo();
    repo.findForRecipientPaged.mockResolvedValue({
      items: [
        entity({
          readAt: new Date('2026-09-16T08:30:00.000Z'),
          resolvedAt: new Date('2026-09-17T00:00:00.000Z'),
        }),
      ],
      total: 1,
    });
    repo.countUnread.mockResolvedValue(0);
    const service = new NotificationsService(repo);

    const { items } = await service.list(ORG, USER, { unread: false });
    const item = items[0];

    expect(item.createdAt).toBe('2026-09-15T06:00:00.000Z');
    expect(item.readAt).toBe('2026-09-16T08:30:00.000Z');
    expect(item.contextData).toEqual({ stageName: 'Structure', dueInDays: 3 });
    expect(item).not.toHaveProperty('resolvedAt');
  });

  it('unreadCount returns the caller-scoped count', async () => {
    const repo = makeRepo();
    repo.countUnread.mockResolvedValue(3);
    const service = new NotificationsService(repo);

    await expect(service.unreadCount(ORG, USER)).resolves.toEqual({ count: 3 });
    expect(repo.countUnread).toHaveBeenCalledWith(ORG, USER);
  });

  it('markRead scopes to the caller and returns the updated item', async () => {
    const repo = makeRepo();
    repo.markRead.mockResolvedValue(entity({ readAt: new Date('2026-09-16T08:30:00.000Z') }));
    const service = new NotificationsService(repo);

    const item = await service.markRead(ORG, USER, 'notif_1');

    expect(repo.markRead).toHaveBeenCalledWith(ORG, USER, 'notif_1');
    expect(item.readAt).toBe('2026-09-16T08:30:00.000Z');
  });

  it('markRead throws 404 (not 403) on a foreign / unknown id — no existence leak', async () => {
    const repo = makeRepo();
    repo.markRead.mockResolvedValue(null);
    const service = new NotificationsService(repo);

    await expect(service.markRead(ORG, USER, 'someone_elses')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('markAllRead returns the updated count', async () => {
    const repo = makeRepo();
    repo.markAllRead.mockResolvedValue(4);
    const service = new NotificationsService(repo);

    await expect(service.markAllRead(ORG, USER)).resolves.toEqual({ updated: 4 });
    expect(repo.markAllRead).toHaveBeenCalledWith(ORG, USER);
  });
});
