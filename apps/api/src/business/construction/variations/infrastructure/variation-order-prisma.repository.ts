import { Injectable } from '@nestjs/common';
import type { Prisma, PrismaClient, VariationOrderStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

type TenantPrisma = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

// A VO with its lines — the shape the service works with for every read.
export type VariationOrderWithLines = Prisma.VariationOrderGetPayload<{ include: { lines: true } }>;

/**
 * ADR-026 (Variations Phase 1) — infrastructure for the VariationOrder aggregate. Prisma lives
 * ONLY here (Clean Architecture). Every read is org-scoped; the service passes `organizationId`
 * from the request identity so a caller can never reach another tenant's variation.
 */
@Injectable()
export class VariationOrderPrismaRepository {
  /** The contract this VO would belong to — org-scoped, with the value the figures derive from. */
  findContract(prisma: TenantPrisma, organizationId: string, contractId: string) {
    return prisma.contract.findFirst({
      where: { id: contractId, organizationId },
      select: {
        id: true,
        projectId: true,
        organizationId: true,
        contractValue: true,
        currency: true,
        status: true,
      },
    });
  }

  /** Highest existing per-contract reference number, for assigning the next `VO-00n`. */
  async nextReferenceSeq(prisma: TenantPrisma, contractId: string): Promise<number> {
    const count = await prisma.variationOrder.count({ where: { contractId } });
    return count + 1;
  }

  findById(
    prisma: TenantPrisma,
    organizationId: string,
    id: string,
  ): Promise<VariationOrderWithLines | null> {
    return prisma.variationOrder.findFirst({
      where: { id, organizationId },
      include: { lines: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  findByContract(prisma: TenantPrisma, organizationId: string, contractId: string) {
    return prisma.variationOrder.findMany({
      where: { organizationId, contractId },
      orderBy: { reference: 'asc' },
      include: { lines: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  /**
   * Lean VO headers for a contract (id/reference/title), org-scoped, ordered by reference. Used by the
   * certified-invoiced-by-VO read to name every VO — including those with zero certified/invoiced.
   */
  findHeadersByContract(prisma: TenantPrisma, organizationId: string, contractId: string) {
    return prisma.variationOrder.findMany({
      where: { organizationId, contractId },
      orderBy: { reference: 'asc' },
      select: { id: true, reference: true, title: true },
    });
  }

  /**
   * CONST-VAR-005/-006: the VO figures the commercial summary derives contract value from. Only
   * status + the line amounts are needed (net price is Σ amount), so this stays a narrow read.
   */
  findValuationInputs(prisma: TenantPrisma, organizationId: string, contractId: string) {
    return prisma.variationOrder.findMany({
      where: { organizationId, contractId },
      select: { id: true, status: true, lines: { select: { amount: true } } },
    });
  }

  create(
    prisma: Prisma.TransactionClient,
    data: {
      organizationId: string;
      contractId: string;
      reference: string;
      title: string;
      description?: string | null;
      proposedTimeImpactDays?: number | null;
      createdBy: string;
      lines: Array<{ description: string; quantity: Decimal; unitRate: Decimal; amount: Decimal; sortOrder: number }>;
    },
  ) {
    return prisma.variationOrder.create({
      data: {
        organizationId: data.organizationId,
        contractId: data.contractId,
        reference: data.reference,
        title: data.title,
        description: data.description ?? null,
        proposedTimeImpactDays: data.proposedTimeImpactDays ?? null,
        createdBy: data.createdBy,
        lines: { create: data.lines },
      },
      include: { lines: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  updateHeader(
    prisma: Prisma.TransactionClient,
    id: string,
    data: Partial<{ title: string; description: string | null; proposedTimeImpactDays: number | null }>,
  ) {
    return prisma.variationOrder.update({ where: { id }, data });
  }

  addLine(
    prisma: Prisma.TransactionClient,
    variationOrderId: string,
    line: { description: string; quantity: Decimal; unitRate: Decimal; amount: Decimal; sortOrder: number },
  ) {
    return prisma.variationOrderLine.create({ data: { variationOrderId, ...line } });
  }

  /** Scoped read — the security guard: a line only mutates via its owning VO. */
  findLineOwned(prisma: TenantPrisma, variationOrderId: string, lineId: string) {
    return prisma.variationOrderLine.findFirst({ where: { id: lineId, variationOrderId } });
  }

  updateLine(
    prisma: Prisma.TransactionClient,
    variationOrderId: string,
    lineId: string,
    data: Partial<{ description: string; quantity: Decimal; unitRate: Decimal; amount: Decimal; sortOrder: number }>,
  ) {
    return prisma.variationOrderLine.updateMany({ where: { id: lineId, variationOrderId }, data });
  }

  removeLine(prisma: Prisma.TransactionClient, variationOrderId: string, lineId: string) {
    return prisma.variationOrderLine.deleteMany({ where: { id: lineId, variationOrderId } });
  }

  /** Applies a lifecycle transition + its audit metadata in one write. */
  transition(
    prisma: Prisma.TransactionClient,
    id: string,
    status: VariationOrderStatus,
    metadata: Prisma.VariationOrderUpdateInput,
  ) {
    return prisma.variationOrder.update({ where: { id }, data: { status, ...metadata } });
  }

  /**
   * ADR-026 CONST-VAR-007 (Phase 2): the VO + its lines + the owning contract's projectId — what the
   * apply-to-BOQ command needs to open the project's BOQ revision. Org-scoped. `boqAppliedAt` is the
   * idempotency marker the service guards on.
   */
  findForApply(prisma: TenantPrisma, organizationId: string, id: string) {
    return prisma.variationOrder.findFirst({
      where: { id, organizationId },
      select: {
        id: true,
        organizationId: true,
        contractId: true,
        reference: true,
        status: true,
        boqAppliedAt: true,
        boqAppliedVersionId: true,
        contract: { select: { projectId: true } },
        lines: { orderBy: { sortOrder: 'asc' } },
      },
    });
  }

  /** CONST-VAR-007: stamp the VO as applied to the BOQ (idempotency record + read indicator). */
  markBoqApplied(
    prisma: Prisma.TransactionClient,
    id: string,
    data: { boqAppliedBy: string; boqAppliedAt: Date; boqAppliedVersionId: string },
  ) {
    return prisma.variationOrder.update({ where: { id }, data });
  }

  /** How many BOQ nodes across all versions carry this VO's provenance — the read indicator. */
  countBoqNodes(prisma: TenantPrisma, variationOrderId: string): Promise<number> {
    return prisma.boqNode.count({ where: { sourceChangeOrderId: variationOrderId } });
  }

  /**
   * ADR-026 CONST-VAR-008 (Variations Phase 3) — the certified certificate-item lines for a contract,
   * each carrying the `sourceChangeOrderId` of the BOQ node it traces to (null ⇒ base scope) and
   * whether the certificate is EFFECTIVE / its ClientInvoice is POSTED.
   *
   * Pure read across the existing join `IpcItem.certifiedAmount → applicationItem(IpaItem).boqNodeId →
   * BoqNode.sourceChangeOrderId`. `InterimPaymentApplicationItem` carries `boqNodeId` as a scalar (no
   * relation object), so the node's `sourceChangeOrderId` is resolved in a second batched read keyed on
   * the distinct node ids. Org-scoped via the certificate's `organizationId`, contract-scoped via the
   * application's `contractId`. NO new column, NO write-path touched. `certifiedAmount` is the ex-VAT
   * line composition; VAT and certificate-level deductions live on headers and never reach this read.
   */
  async findCertifiedInvoicedLines(
    prisma: TenantPrisma,
    organizationId: string,
    contractId: string,
  ): Promise<
    Array<{
      sourceChangeOrderId: string | null;
      certifiedAmount: Decimal;
      isEffective: boolean;
      invoicePosted: boolean;
    }>
  > {
    const items = await prisma.interimPaymentCertificateItem.findMany({
      where: {
        certificate: {
          organizationId,
          application: { contractId },
        },
      },
      select: {
        certifiedAmount: true,
        applicationItem: { select: { boqNodeId: true } },
        certificate: {
          select: {
            isEffective: true,
            clientInvoice: { select: { postingStatus: true } },
          },
        },
      },
    });

    // Resolve each referenced BOQ node's provenance in one batched read (node → sourceChangeOrderId).
    const nodeIds = Array.from(new Set(items.map((it) => it.applicationItem.boqNodeId)));
    const nodes =
      nodeIds.length === 0
        ? []
        : await prisma.boqNode.findMany({
            where: { id: { in: nodeIds } },
            select: { id: true, sourceChangeOrderId: true },
          });
    const sourceByNode = new Map(nodes.map((n) => [n.id, n.sourceChangeOrderId]));

    return items.map((it) => ({
      sourceChangeOrderId: sourceByNode.get(it.applicationItem.boqNodeId) ?? null,
      certifiedAmount: it.certifiedAmount as Decimal,
      isEffective: it.certificate.isEffective,
      invoicePosted: it.certificate.clientInvoice?.postingStatus === 'POSTED',
    }));
  }
}
