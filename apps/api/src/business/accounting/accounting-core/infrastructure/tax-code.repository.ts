import { Injectable } from '@nestjs/common';
import { Prisma, type PrismaClient, type TaxCode, type TaxDirection } from '@prisma/client';

type TenantPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/** ADR-041 — tax codes and the organisation's default sales tax code (`TaxPolicy`). */
@Injectable()
export class TaxCodeRepository {
  findAll(prisma: TenantPrisma, organizationId: string): Promise<TaxCode[]> {
    return prisma.taxCode.findMany({
      where: { organizationId },
      orderBy: [{ direction: 'asc' }, { status: 'asc' }, { code: 'asc' }],
    });
  }

  findById(prisma: TenantPrisma, organizationId: string, id: string): Promise<TaxCode | null> {
    return prisma.taxCode.findFirst({ where: { id, organizationId } });
  }

  findByCode(prisma: TenantPrisma, organizationId: string, code: string): Promise<TaxCode | null> {
    return prisma.taxCode.findUnique({ where: { organizationId_code: { organizationId, code } } });
  }

  async findDefaultOutputId(prisma: TenantPrisma, organizationId: string): Promise<string | null> {
    const policy = await prisma.taxPolicy.findUnique({
      where: { organizationId },
      select: { defaultOutputTaxCodeId: true },
    });
    return policy?.defaultOutputTaxCodeId ?? null;
  }

  create(
    prisma: TenantPrisma,
    data: {
      organizationId: string;
      code: string;
      name: string;
      ratePercent: Prisma.Decimal | number;
      direction: TaxDirection;
      effectiveFrom: Date;
      createdBy: string;
    },
  ): Promise<TaxCode> {
    return prisma.taxCode.create({
      data: {
        organizationId: data.organizationId,
        code: data.code,
        name: data.name,
        rate: data.ratePercent,
        taxType: 'VAT',
        direction: data.direction,
        // ACC-TAX-001: input tax is absorbed into cost. Output tax is never "recovered"; the seed
        // records it as FULLY_RECOVERABLE and new codes mirror that.
        recoveryMethod: data.direction === 'INPUT' ? 'NON_RECOVERABLE' : 'FULLY_RECOVERABLE',
        effectiveFrom: data.effectiveFrom,
        status: 'ACTIVE',
        createdBy: data.createdBy,
      },
    });
  }

  setStatus(prisma: TenantPrisma, id: string, status: 'ACTIVE' | 'INACTIVE'): Promise<TaxCode> {
    return prisma.taxCode.update({ where: { id }, data: { status } });
  }

  setDefaultOutput(prisma: TenantPrisma, organizationId: string, taxCodeId: string, updatedBy: string) {
    return prisma.taxPolicy.upsert({
      where: { organizationId },
      create: { organizationId, defaultOutputTaxCodeId: taxCodeId, updatedBy },
      update: { defaultOutputTaxCodeId: taxCodeId, updatedBy },
    });
  }

  async recordAudit(
    tx: TenantPrisma,
    data: {
      organizationId: string;
      userId: string;
      action: string;
      resourceId: string;
      before?: Record<string, unknown>;
      after?: Record<string, unknown>;
      sourceCommand: string;
    },
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        userId: data.userId,
        orgId: data.organizationId,
        action: data.action,
        resource: 'tax-code',
        resourceId: data.resourceId,
        before: data.before as Prisma.InputJsonValue | undefined,
        after: data.after as Prisma.InputJsonValue | undefined,
        sourceCommand: data.sourceCommand,
      },
    });
  }
}
