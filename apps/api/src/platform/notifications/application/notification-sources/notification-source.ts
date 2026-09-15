import type { PrismaClient } from '@prisma/client';

import type { UpsertNotificationData } from '../../domain/notification-repository.interface.js';

/**
 * ADR-031 — a notification source is a strategy: it knows how to read ONE family of live conditions
 * for an org and turn each into the rows to upsert. Adding a new notification kind is one new file
 * implementing this interface, registered in the generator's source list — nothing else changes.
 *
 * Auto-resolve keys on the `dedupeKey`, not the `resourceId`: the generator gathers every live
 * dedupeKey a source produces this cycle, then closes any un-resolved row of that `resourceType` whose
 * key is no longer live. Keying on dedupeKey (not resourceId) is what closes a SUPERSEDED row when a
 * still-live resource changes key — a stage that slips DUE→OVERDUE, or an invoice that ages into a new
 * band — so the same condition never stacks two open notifications.
 */
export interface NotificationSource<Condition extends { resourceId: string; projectId: string | null }> {
  /** The `resourceType` stamped on every row this source produces. */
  readonly resourceType: string;

  /** Read the live conditions for this source in the given org, at time `now`. */
  findLiveConditions(prisma: PrismaClient, organizationId: string, now: Date): Promise<Condition[]>;

  /** The dedupe key for a condition — the auto-resolve axis; MUST equal the key `toRow` emits. */
  toDedupeKey(condition: Condition): string;

  /** Build the upsert payload for one recipient of one condition (org supplied by the generator). */
  toRow(
    condition: Condition,
    recipientUserId: string,
    organizationId: string,
  ): UpsertNotificationData;
}
