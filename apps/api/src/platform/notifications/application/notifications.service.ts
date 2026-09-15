import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  MarkAllReadResponse,
  NotificationItem,
  NotificationListResponse,
  UnreadCountResponse,
} from '@erp/types';

import type { NotificationEntity } from '../domain/notification.entity.js';
import type { INotificationRepository } from '../domain/notification-repository.interface.js';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;

/**
 * ADR-031 — read + mark-read use cases. Every operation is scoped to the caller's own
 * (organizationId, userId): a user only ever sees, counts, or mutates their own rows, and the guard
 * against a foreign id is a 404 (never a 403) so the endpoint leaks no existence signal.
 */
@Injectable()
export class NotificationsService {
  constructor(
    @Inject('INotificationRepository')
    private readonly notificationRepository: INotificationRepository,
  ) {}

  async list(
    organizationId: string,
    userId: string,
    params: { unread: boolean; page?: number; limit?: number },
  ): Promise<NotificationListResponse> {
    const page = params.page ?? DEFAULT_PAGE;
    const limit = params.limit ?? DEFAULT_LIMIT;

    const [{ items, total }, unreadTotal] = await Promise.all([
      this.notificationRepository.findForRecipientPaged(organizationId, userId, {
        unread: params.unread,
        page,
        limit,
      }),
      // The badge count is the caller's total unread regardless of the page or the `unread` filter.
      this.notificationRepository.countUnread(organizationId, userId),
    ]);

    return {
      items: items.map((entity) => this.toItem(entity)),
      page,
      limit,
      total,
      unreadTotal,
    };
  }

  async unreadCount(organizationId: string, userId: string): Promise<UnreadCountResponse> {
    const count = await this.notificationRepository.countUnread(organizationId, userId);
    return { count };
  }

  async markRead(organizationId: string, userId: string, notificationId: string): Promise<NotificationItem> {
    const updated = await this.notificationRepository.markRead(organizationId, userId, notificationId);
    if (!updated) {
      // Foreign / non-existent / already-resolved id → 404, never 403 (no existence leak).
      throw new NotFoundException(`Notification ${notificationId} not found`);
    }
    return this.toItem(updated);
  }

  async markAllRead(organizationId: string, userId: string): Promise<MarkAllReadResponse> {
    const updated = await this.notificationRepository.markAllRead(organizationId, userId);
    return { updated };
  }

  /**
   * DB row → wire shape. Dates become ISO strings; `contextData` is passed through untouched. Note
   * `resolvedAt` is deliberately NOT projected — resolved rows never leave the server, and the shape
   * has no field for it.
   */
  private toItem(entity: NotificationEntity): NotificationItem {
    return {
      id: entity.id,
      kind: entity.kind,
      severity: entity.severity,
      projectId: entity.projectId,
      contractId: entity.contractId,
      resourceType: entity.resourceType,
      resourceId: entity.resourceId,
      contextData: entity.contextData,
      actionUrl: entity.actionUrl,
      readAt: entity.readAt ? entity.readAt.toISOString() : null,
      createdAt: entity.createdAt.toISOString(),
    };
  }
}
