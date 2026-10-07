import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { RequestIdentity } from '@erp/types';
import type { TransactionalAuditOutboxService } from '../../../../platform/audit-logs/application/transactional-audit-outbox.service.js';

/** List filter for catalogue master data. ACTIVE is the default, so pickers are unchanged. */
export type CatalogueStatusFilter = 'ACTIVE' | 'INACTIVE' | 'ALL';
export const CATALOGUE_STATUS_FILTERS: readonly CatalogueStatusFilter[] = ['ACTIVE', 'INACTIVE', 'ALL'];

type TxRunner = { $transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> };

/**
 * Changes a catalogue record's status and records it on the audit trail in the same transaction.
 * `allowedFrom` guards the transition: e.g. reactivate only from an inactive status (409 otherwise).
 */
export async function changeCatalogueStatus<T>(
  prisma: TxRunner,
  auditOutbox: TransactionalAuditOutboxService,
  identity: RequestIdentity,
  opts: {
    resourceType: string;
    resourceId: string;
    label: string;
    from: string;
    to: string;
    allowedFrom: readonly string[];
    sourceCommand: string;
    eventType: string;
    write: (tx: Prisma.TransactionClient) => Promise<T>;
  },
): Promise<T> {
  if (!opts.allowedFrom.includes(opts.from)) {
    throw new ConflictException(`${opts.label} is ${opts.from} — cannot change it to ${opts.to}`);
  }
  return prisma.$transaction(async (tx) => {
    const updated = await opts.write(tx);
    await auditOutbox.record(tx, {
      organizationId: identity.activeOrganizationId,
      actorUserId: identity.userId,
      action: 'UPDATE',
      resourceType: opts.resourceType,
      resourceId: opts.resourceId,
      sourceCommand: opts.sourceCommand,
      eventType: opts.eventType,
      idempotencyKey: `${opts.sourceCommand}-${opts.resourceId}-${(updated as { updatedAt?: Date }).updatedAt?.getTime() ?? Date.now()}`,
      before: { status: opts.from },
      after: { status: opts.to },
    });
    return updated;
  });
}
