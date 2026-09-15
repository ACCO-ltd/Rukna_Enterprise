import type { NotificationKind, NotificationSeverity } from '@erp/types';

/**
 * ADR-031 — the domain shape of a persisted notification, as read back from the store. This is the
 * server-side record: it carries `resolvedAt` (which the wire response deliberately drops) so the
 * application layer can reason about resolved rows without a second read.
 */
export class NotificationEntity {
  constructor(
    public readonly id: string,
    public readonly organizationId: string,
    public readonly recipientUserId: string,
    public readonly kind: NotificationKind,
    public readonly severity: NotificationSeverity,
    public readonly dedupeKey: string,
    public readonly projectId: string | null,
    public readonly contractId: string | null,
    public readonly resourceType: string,
    public readonly resourceId: string,
    public readonly contextData: Record<string, string | number> | null,
    public readonly actionUrl: string | null,
    public readonly readAt: Date | null,
    public readonly resolvedAt: Date | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}
}
