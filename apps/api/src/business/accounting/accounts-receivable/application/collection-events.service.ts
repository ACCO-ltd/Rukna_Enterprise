import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import type { RequestIdentity } from '@erp/types';
import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';

type TenantPrisma = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

// ─── DTOs ────────────────────────────────────────────────────────────────────

export interface RecordFollowUpDto {
  invoiceId: string;
  method: 'WHATSAPP' | 'EMAIL' | 'PHONE' | 'PHYSICAL' | 'OTHER';
  contactPerson?: string;
  note?: string;
  /** ISO date string */
  occurredAt: string;
}

/**
 * Payment promise. Intentionally has NO `dueDate` field — a promise must never overwrite
 * the contractual due date on the invoice. Structural enforcement.
 */
export interface RecordPromiseDto {
  invoiceId: string;
  /** YYYY-MM-DD — the date the client committed to pay. */
  promisedDate: string;
  /** Decimal string, optional. Null means "the full outstanding balance". */
  promisedAmount?: string;
  note?: string;
}

/**
 * Dispute open. Intentionally has NO `outstandingAmount` field — a dispute never adjusts
 * the AR balance. Structural enforcement.
 */
export interface OpenDisputeDto {
  invoiceId: string;
  disputedAmount?: string;
  reason: 'OMISSION' | 'PRICE_ERROR' | 'WORK_NOT_ACCEPTED' | 'SCOPE_DISAGREEMENT' | 'OTHER';
  note?: string;
}

export interface ResolveDisputeDto {
  disputeId: string;
  resolutionNote?: string;
}

@Injectable()
export class CollectionEventsService {
  constructor(private readonly tenancyService: TenancyService) {}

  // ─── recordFollowUp ────────────────────────────────────────────────────────

  async recordFollowUp(identity: RequestIdentity, dto: RecordFollowUpDto) {
    const prisma = this.tenancyService.getClient() as TenantPrisma;
    const { activeOrganizationId: orgId, userId } = identity;

    const invoice = await prisma.clientInvoice.findFirst({
      where: { id: dto.invoiceId, organizationId: orgId },
      select: { id: true },
    });
    if (!invoice) throw new NotFoundException(`ClientInvoice ${dto.invoiceId} not found`);

    return prisma.invoiceFollowUp.create({
      data: {
        organizationId: orgId,
        invoiceId: dto.invoiceId,
        method: dto.method as never,
        contactPerson: dto.contactPerson?.trim() || null,
        note: dto.note?.trim() || null,
        occurredAt: new Date(dto.occurredAt),
        recordedBy: userId,
      },
    });
  }

  // ─── recordPromise ─────────────────────────────────────────────────────────

  async recordPromise(identity: RequestIdentity, dto: RecordPromiseDto) {
    const prisma = this.tenancyService.getClient() as TenantPrisma;
    const { activeOrganizationId: orgId, userId } = identity;

    const invoice = await prisma.clientInvoice.findFirst({
      where: { id: dto.invoiceId, organizationId: orgId },
      select: { id: true, outstandingAmount: true },
    });
    if (!invoice) throw new NotFoundException(`ClientInvoice ${dto.invoiceId} not found`);

    const outstandingAtPromise = new Decimal(invoice.outstandingAmount.toString());

    // Invariant: we never touch invoice.dueDate
    return prisma.invoicePaymentPromise.create({
      data: {
        organizationId: orgId,
        invoiceId: dto.invoiceId,
        promisedDate: new Date(dto.promisedDate),
        promisedAmount: dto.promisedAmount ? new Decimal(dto.promisedAmount) : null,
        outstandingAtPromise,
        note: dto.note?.trim() || null,
        recordedBy: userId,
      },
    });
  }

  // ─── openDispute ──────────────────────────────────────────────────────────

  async openDispute(identity: RequestIdentity, dto: OpenDisputeDto) {
    const prisma = this.tenancyService.getClient() as TenantPrisma;
    const { activeOrganizationId: orgId, userId } = identity;

    const invoice = await prisma.clientInvoice.findFirst({
      where: { id: dto.invoiceId, organizationId: orgId },
      select: { id: true },
    });
    if (!invoice) throw new NotFoundException(`ClientInvoice ${dto.invoiceId} not found`);

    // At most ONE open dispute per invoice
    const openCount = await prisma.invoiceDispute.count({
      where: { invoiceId: dto.invoiceId, organizationId: orgId, resolvedAt: null },
    });
    if (openCount > 0) {
      throw new ConflictException(
        `Invoice ${dto.invoiceId} already has an open dispute. Resolve it before opening another.`,
      );
    }

    // Invariant: we never touch any invoice amount fields
    return prisma.invoiceDispute.create({
      data: {
        organizationId: orgId,
        invoiceId: dto.invoiceId,
        disputedAmount: dto.disputedAmount ? new Decimal(dto.disputedAmount) : null,
        reason: dto.reason as never,
        note: dto.note?.trim() || null,
        openedBy: userId,
      },
    });
  }

  // ─── resolveDispute ────────────────────────────────────────────────────────

  async resolveDispute(identity: RequestIdentity, dto: ResolveDisputeDto) {
    const prisma = this.tenancyService.getClient() as TenantPrisma;
    const { activeOrganizationId: orgId, userId } = identity;

    const dispute = await prisma.invoiceDispute.findFirst({
      where: { id: dto.disputeId, organizationId: orgId },
    });
    if (!dispute) throw new NotFoundException(`InvoiceDispute ${dto.disputeId} not found`);

    if (dispute.resolvedAt !== null) {
      throw new ConflictException(`Dispute ${dto.disputeId} is already resolved.`);
    }

    // Invariant: no GL mutation, no invoice amount change
    return prisma.invoiceDispute.update({
      where: { id: dto.disputeId },
      data: {
        resolvedAt: new Date(),
        resolvedBy: userId,
        resolutionNote: dto.resolutionNote?.trim() || null,
      },
    });
  }

  // ─── derivePromiseStatus ───────────────────────────────────────────────────

  /**
   * Pure derivation — no DB access.
   *
   * effectiveTarget = promisedAmount ?? outstandingAtPromise
   * - KEPT: allocationsAfterPromise >= effectiveTarget
   * - ACTIVE: promisedDate >= today
   * - MISSED: otherwise (past due, not collected)
   */
  static derivePromiseStatus(
    promise: {
      promisedDate: Date;
      promisedAmount: Decimal | null;
      outstandingAtPromise: Decimal;
      recordedAt: Date;
    },
    allocationsAfterPromise: Decimal,
    today: string,
  ): 'ACTIVE' | 'KEPT' | 'MISSED' {
    const effectiveTarget = promise.promisedAmount ?? promise.outstandingAtPromise;

    if (allocationsAfterPromise.gte(effectiveTarget)) return 'KEPT';

    const promisedDateIso = promise.promisedDate.toISOString().slice(0, 10);
    if (promisedDateIso >= today) return 'ACTIVE';

    return 'MISSED';
  }
}
