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

    // Validate variance reasons on items where certified ≠ claimed.
    if (dto.items) {
      for (const item of dto.items) {
        const appItem = await prisma.interimPaymentApplicationItem.findUnique({
          where: { id: item.applicationItemId },
          select: { cumulativeClaimed: true, unitRateSnapshot: true },
        });
        if (!appItem) {
          throw new NotFoundException(`Application item ${item.applicationItemId} not found`);
        }
        const certified = new Decimal(item.certifiedQuantity);
        const claimed = new Decimal(appItem.cumulativeClaimed.toString());
        if (!certified.equals(claimed) && !item.varianceReason) {
          throw new BadRequestException(
            `varianceReason is required for item ${item.applicationItemId} because certifiedQuantity (${certified}) ≠ cumulativeClaimed (${claimed})`,
          );
        }
      }
    }

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
      certifiedTotal: dto.certifiedTotal,
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

    // Persist line items.
    if (dto.items) {
      for (const item of dto.items) {
        const appItem = await prisma.interimPaymentApplicationItem.findUnique({
          where: { id: item.applicationItemId },
          select: { cumulativeClaimed: true, unitRateSnapshot: true },
        });
        if (appItem) {
          const certifiedQty = new Decimal(item.certifiedQuantity);
          const claimedQty = new Decimal(appItem.cumulativeClaimed.toString());
          const varianceQty = certifiedQty.sub(claimedQty);
          const certifiedAmount = certifiedQty.mul(new Decimal(appItem.unitRateSnapshot.toString()));

          await this.repo.addItem(prisma, cert.id, {
            applicationItemId: item.applicationItemId,
            certifiedQuantity: item.certifiedQuantity,
            certifiedAmount: certifiedAmount.toFixed(2),
            varianceQuantity: varianceQty.toFixed(3),
            varianceReason: item.varianceReason,
          });
        }
      }
    }

    // Persist deductions.
    if (dto.deductions) {
      for (const ded of dto.deductions) {
        await this.repo.addDeduction(prisma, cert.id, {
          deductionType: ded.deductionType,
          sourceTermId: ded.sourceTermId,
          rate: ded.rate,
          basis: ded.basis,
          amount: ded.amount,
        });
      }
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
