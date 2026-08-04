import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import type { RequestIdentity } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { IpcPrismaRepository } from '../infrastructure/ipc-prisma.repository.js';
import type { CreateIpcDto } from '../presentation/dto/create-ipc.dto.js';
import type { SupersedeIpcDto } from '../presentation/dto/supersede-ipc.dto.js';

const EFFECTIVE_STATUSES = new Set(['CERTIFIED', 'PARTIALLY_CERTIFIED']);

@Injectable()
export class IpcService {
  constructor(
    private readonly tenancyService: TenancyService,
    private readonly repo: IpcPrismaRepository,
  ) {}

  async findAll(identity: RequestIdentity, applicationId?: string) {
    const prisma = this.tenancyService.getClient();
    return this.repo.findAll(prisma, identity.activeOrganizationId, applicationId);
  }

  async findOne(identity: RequestIdentity, id: string) {
    const prisma = this.tenancyService.getClient();
    const ipc = await this.repo.findById(prisma, identity.activeOrganizationId, id);
    if (!ipc) throw new NotFoundException(`IPC ${id} not found`);

    const totalCertifiedAmount = ipc.items.reduce(
      (sum, i) => sum.plus(new Decimal(i.certifiedAmount.toString())),
      new Decimal(0),
    );
    const totalDeductions = ipc.deductions.reduce(
      (sum, d) => sum.plus(new Decimal(d.amount.toString())),
      new Decimal(0),
    );

    return {
      ...ipc,
      totalCertifiedAmount: totalCertifiedAmount.toFixed(2),
      totalDeductions: totalDeductions.toFixed(2),
      netCertified: totalCertifiedAmount.minus(totalDeductions).toFixed(2),
    };
  }

  async issue(identity: RequestIdentity, dto: CreateIpcDto) {
    const prisma = this.tenancyService.getClient();

    // Guard: IPA must exist, belong to this org, and be SUBMITTED.
    const ipa = await prisma.interimPaymentApplication.findFirst({
      where: { id: dto.applicationId, organizationId: identity.activeOrganizationId },
      select: { id: true, status: true, contractId: true },
    });
    if (!ipa) throw new NotFoundException(`Application ${dto.applicationId} not found`);
    if (ipa.status !== 'SUBMITTED') {
      throw new BadRequestException(
        `A certificate can only be issued against a SUBMITTED application. Current status: ${ipa.status}`,
      );
    }

    // Load contract for deduction derivation.
    const contract = await prisma.contract.findUnique({
      where: { id: ipa.contractId },
      select: {
        retentionTerms: { select: { retentionRate: true } },
        advanceTerms: { select: { id: true, recoveryRate: true } },
      },
    });

    // Single pass: validate + compute certifiedAmount per item.
    type ComputedItem = {
      applicationItemId: string;
      certifiedQuantity: string;
      certifiedAmount: Decimal;
      varianceQuantity: string;
      varianceReason?: string;
    };
    const computedItems: ComputedItem[] = [];

    for (const item of dto.items ?? []) {
      const appItem = await prisma.interimPaymentApplicationItem.findUnique({
        where: { id: item.applicationItemId },
        select: { cumulativeClaimed: true, unitRateSnapshot: true, applicationId: true },
      });
      if (!appItem) {
        throw new NotFoundException(`Application item ${item.applicationItemId} not found`);
      }
      if (appItem.applicationId !== dto.applicationId) {
        throw new BadRequestException(
          `Application item ${item.applicationItemId} does not belong to application ${dto.applicationId}`,
        );
      }
      const certifiedQty = new Decimal(item.certifiedQuantity);
      const claimedQty = new Decimal(appItem.cumulativeClaimed.toString());
      if (!certifiedQty.equals(claimedQty) && !item.varianceReason) {
        throw new BadRequestException(
          `varianceReason is required for item ${item.applicationItemId} because certifiedQuantity (${certifiedQty}) ≠ cumulativeClaimed (${claimedQty})`,
        );
      }
      const certifiedAmount = certifiedQty.mul(new Decimal(appItem.unitRateSnapshot.toString()));
      computedItems.push({
        applicationItemId: item.applicationItemId,
        certifiedQuantity: item.certifiedQuantity,
        certifiedAmount,
        varianceQuantity: certifiedQty.sub(claimedQty).toFixed(3),
        varianceReason: item.varianceReason,
      });
    }

    // Server-computed gross total from items.
    const certifiedTotal = computedItems.reduce(
      (sum, i) => sum.plus(i.certifiedAmount),
      new Decimal(0),
    );

    const certNum = await this.repo.getNextCertificateNumber(prisma, dto.applicationId);

    // First valid (non-REJECTED) certificate for this application becomes effective automatically.
    const existingEffective = await this.repo.findEffectiveByApplication(prisma, dto.applicationId);
    const shouldBeEffective = EFFECTIVE_STATUSES.has(dto.status) && !existingEffective;
    const now = new Date();

    const cert = await this.repo.create(prisma, {
      applicationId: dto.applicationId,
      organizationId: identity.activeOrganizationId,
      certificateNumber: certNum,
      certificateRef: `IPC-${certNum.toString().padStart(3, '0')}`,
      status: dto.status,
      isEffective: shouldBeEffective,
      effectiveAt: shouldBeEffective ? now : undefined,
      certifiedTotal: certifiedTotal.toFixed(2),
      currency: dto.currency,
      exchangeRateCurrency: dto.exchangeRateCurrency,
      exchangeRateBase: dto.exchangeRateBase,
      exchangeRateValue: dto.exchangeRateValue,
      exchangeRateDate: dto.exchangeRateDate ? new Date(dto.exchangeRateDate) : undefined,
      issuedAt: shouldBeEffective ? now : undefined,
      issuedBy: shouldBeEffective ? identity.userId : undefined,
      notes: dto.notes,
      createdBy: identity.userId,
    });

    // Persist line items using pre-computed values (no second DB fetch).
    for (const item of computedItems) {
      await this.repo.addItem(prisma, cert.id, {
        applicationItemId: item.applicationItemId,
        certifiedQuantity: item.certifiedQuantity,
        certifiedAmount: item.certifiedAmount.toFixed(2),
        varianceQuantity: item.varianceQuantity,
        varianceReason: item.varianceReason,
      });
    }

    // Auto-generate standard deductions from contract terms.
    if (contract?.retentionTerms && certifiedTotal.greaterThan(0)) {
      const rate = new Decimal(contract.retentionTerms.retentionRate.toString());
      await this.repo.addDeduction(prisma, cert.id, {
        deductionType: 'RETENTION',
        rate: rate.toString(),
        basis: certifiedTotal.toFixed(2),
        amount: certifiedTotal.mul(rate).toFixed(2),
      });
    }
    for (const term of contract?.advanceTerms ?? []) {
      if (certifiedTotal.greaterThan(0)) {
        const rate = new Decimal(term.recoveryRate.toString());
        await this.repo.addDeduction(prisma, cert.id, {
          deductionType: 'ADVANCE_RECOVERY',
          sourceTermId: term.id,
          rate: rate.toString(),
          basis: certifiedTotal.toFixed(2),
          amount: certifiedTotal.mul(rate).toFixed(2),
        });
      }
    }

    // Persist ad-hoc deductions (client-supplied). Skip contract types — already computed above.
    const CONTRACT_TYPES = new Set(['RETENTION', 'ADVANCE_RECOVERY']);
    for (const ded of dto.deductions ?? []) {
      if (CONTRACT_TYPES.has(ded.deductionType)) continue;
      await this.repo.addDeduction(prisma, cert.id, {
        deductionType: ded.deductionType,
        sourceTermId: ded.sourceTermId,
        rate: ded.rate,
        basis: ded.basis,
        amount: ded.amount,
      });
    }

    return this.repo.findById(prisma, identity.activeOrganizationId, cert.id);
  }

  // ─── Supersession ─────────────────────────────────────────────────────────────

  async supersede(identity: RequestIdentity, applicationId: string, dto: SupersedeIpcDto) {
    const prisma = this.tenancyService.getClient();

    const currentEffective = await this.repo.findEffectiveByApplication(prisma, applicationId);
    if (!currentEffective) {
      throw new BadRequestException(
        `No effective certificate exists for application ${applicationId}. ` +
        'Supersession requires an existing effective certificate.',
      );
    }

    const newCert = await this.repo.findById(
      prisma,
      identity.activeOrganizationId,
      dto.newCertificateId,
    );
    if (!newCert) throw new NotFoundException(`Certificate ${dto.newCertificateId} not found`);

    if (newCert.applicationId !== applicationId) {
      throw new BadRequestException('The new certificate does not belong to this application');
    }
    if (newCert.isEffective) {
      throw new ConflictException('The certificate is already the effective one');
    }
    if (!EFFECTIVE_STATUSES.has(newCert.status)) {
      throw new BadRequestException(
        `Cannot make a ${newCert.status} certificate effective. Only CERTIFIED or PARTIALLY_CERTIFIED certificates can supersede.`,
      );
    }

    return this.repo.supersede(
      prisma,
      currentEffective.id,
      dto.newCertificateId,
      dto.reason,
      identity.userId,
    );
  }
}
