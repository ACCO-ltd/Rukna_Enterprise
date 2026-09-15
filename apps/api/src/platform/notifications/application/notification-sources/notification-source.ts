import type { PrismaClient } from '@prisma/client';

import type { UpsertNotificationData } from '../../domain/notification-repository.interface.js';

/**
 * ADR-031 — a notification source is a strategy: it knows how to read ONE family of live conditions
 * for an org and turn each into the rows to upsert. Adding a new notification kind is one new file
 * implementing this interface, registered in the generator's source list — nothing else changes.
 *
 * `resourceType` is the auto-resolve axis: the generator gathers every live `resourceId` for a source,
 * then closes any un-resolved row of that `resourceType` whose resource is no longer live.
 */
export interface NotificationSource<Condition extends { resourceId: string; projectId: string | null }> {
  /** The `resourceType` stamped on every row this source produces, and the auto-resolve key. */
  readonly resourceType: string;

  /** Read the live conditions for this source in the given org, at time `now`. */
  findLiveConditions(prisma: PrismaClient, organizationId: string, now: Date): Promise<Condition[]>;

  /** Build the upsert payload for one recipient of one condition (org supplied by the generator). */
  toRow(
    condition: Condition,
    recipientUserId: string,
    organizationId: string,
  ): UpsertNotificationData;
}
