import { Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { dedupeKey, invoiceBucket, type InvoiceOverdueBucket } from '../../domain/dedupe-key.js';
import { utcCalendarDaysUntil } from '../../domain/installment-due-attention.policy.js';
import { deriveNotificationSeverity } from '../../domain/notification-severity.policy.js';
import type { UpsertNotificationData } from '../../domain/notification-repository.interface.js';
import type { NotificationSource } from './notification-source.js';

export const CLIENT_INVOICE_RESOURCE_TYPE = 'ClientInvoice';

/** One posted, non-cancelled client invoice that is past due with an outstanding balance. */
export interface ClientInvoiceOverdueCondition {
  resourceId: string;
  projectId: string | null;
  contractId: string | null;
  invoiceNumber: string;
  daysOverdue: number;
  bucket: InvoiceOverdueBucket;
  actionUrl: string;
}

/**
 * ADR-031 — client-invoice-overdue source. Reads posted, uncancelled invoices with an outstanding
 * balance whose due date is in the past, and maps each to a CLIENT_INVOICE_OVERDUE notification keyed
 * by age bucket (so an aging invoice re-alerts once per band, not every day).
 *
 * "Live" for auto-resolve = still outstanding & posted & uncancelled & past due. When the invoice is
 * paid (`outstandingAmount = 0`), cancelled, or reversed, it drops out here → the generator closes any
 * open row for it. When the invoice ages into a NEW band its dedupeKey changes; auto-resolve keys on
 * the live dedupeKeys, so the superseded band's row is closed and only the current band's row remains.
 */
@Injectable()
export class ClientInvoiceOverdueSource implements NotificationSource<ClientInvoiceOverdueCondition> {
  readonly resourceType = CLIENT_INVOICE_RESOURCE_TYPE;

  async findLiveConditions(
    prisma: PrismaClient,
    organizationId: string,
    now: Date,
  ): Promise<ClientInvoiceOverdueCondition[]> {
    // Compare on the UTC calendar day so a `@db.Date` due date never drifts by timezone.
    const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    const invoices = await prisma.clientInvoice.findMany({
      where: {
        organizationId,
        outstandingAmount: { gt: 0 },
        postingStatus: 'POSTED',
        documentStatus: { not: 'CANCELLED' },
        dueDate: { lt: todayUtc },
      },
      select: {
        id: true,
        invoiceNumber: true,
        dueDate: true,
        projectId: true,
        contractId: true,
      },
    });

    const conditions: ClientInvoiceOverdueCondition[] = [];
    for (const invoice of invoices) {
      // daysOverdue = today − dueDate on UTC calendar days (positive, since dueDate < today).
      const daysOverdue = -utcCalendarDaysUntil(invoice.dueDate, now);
      if (daysOverdue <= 0) continue;
      const bucket = invoiceBucket(daysOverdue);
      conditions.push({
        resourceId: invoice.id,
        projectId: invoice.projectId,
        contractId: invoice.contractId,
        invoiceNumber: invoice.invoiceNumber ?? '—',
        daysOverdue,
        bucket,
        actionUrl: invoice.projectId
          ? `/projects/${invoice.projectId}/commercial/billing-collection`
          : `/finance/accounting/invoices/${invoice.id}`,
      });
    }
    return conditions;
  }

  toDedupeKey(condition: ClientInvoiceOverdueCondition): string {
    return dedupeKey.invoiceOverdue(condition.resourceId, condition.bucket);
  }

  toRow(
    condition: ClientInvoiceOverdueCondition,
    recipientUserId: string,
    organizationId: string,
  ): UpsertNotificationData {
    return {
      organizationId,
      recipientUserId,
      kind: 'CLIENT_INVOICE_OVERDUE',
      severity: deriveNotificationSeverity('CLIENT_INVOICE_OVERDUE', condition.bucket),
      dedupeKey: this.toDedupeKey(condition),
      projectId: condition.projectId,
      contractId: condition.contractId,
      resourceType: this.resourceType,
      resourceId: condition.resourceId,
      contextData: {
        invoiceNumber: condition.invoiceNumber,
        daysOverdue: condition.daysOverdue,
      },
      actionUrl: condition.actionUrl,
    };
  }
}
