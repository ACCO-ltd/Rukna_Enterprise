import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import type { RequestIdentity } from '@erp/types';

import { TenancyService } from '../../../platform/tenancy/tenancy.service.js';
import { FinancePrismaRepository, ReceiptFull } from '../infrastructure/finance-prisma.repository.js';
import type { CreateReceiptDto } from '../presentation/dto/create-receipt.dto.js';
import type { AllocateReceiptDto } from '../presentation/dto/allocate-receipt.dto.js';

@Injectable()
export class FinanceService {
  constructor(
    private readonly tenancyService: TenancyService,
    private readonly repo: FinancePrismaRepository,
  ) {}

  async findAll(identity: RequestIdentity, clientId?: string) {
    const prisma = this.tenancyService.getClient();
    return this.repo.findAll(prisma, identity.activeOrganizationId, clientId);
  }

  async findOne(identity: RequestIdentity, id: string): Promise<ReceiptFull> {
    const prisma = this.tenancyService.getClient();
    const receipt = await this.repo.findById(prisma, identity.activeOrganizationId, id);
    if (!receipt) throw new NotFoundException(`PaymentReceipt ${id} not found`);
    return receipt;
  }

  async create(identity: RequestIdentity, dto: CreateReceiptDto) {
    const prisma = this.tenancyService.getClient();
    return this.repo.create(prisma, {
      organizationId: identity.activeOrganizationId,
      clientId: dto.clientId,
      receiptDate: new Date(dto.receiptDate),
      amount: dto.amount,
      currency: dto.currency,
      exchangeRate: dto.exchangeRate,
      reference: dto.reference,
      notes: dto.notes,
      createdBy: identity.userId,
    });
  }

  async allocate(identity: RequestIdentity, receiptId: string, dto: AllocateReceiptDto) {
    const prisma = this.tenancyService.getClient();
    const receipt = await this.requireReceipt(prisma, identity.activeOrganizationId, receiptId);

    // Verify the certificate belongs to this org, the same client, and the same currency.
    const cert = await prisma.interimPaymentCertificate.findFirst({
      where: { id: dto.certificateId, organizationId: identity.activeOrganizationId },
      select: {
        id: true,
        currency: true,
        application: { select: { contract: { select: { clientId: true } } } },
      },
    });
    if (!cert) throw new NotFoundException(`Certificate ${dto.certificateId} not found`);
    if (cert.application.contract.clientId !== receipt.clientId) {
      throw new BadRequestException(
        `Certificate ${dto.certificateId} belongs to a different client than this receipt`,
      );
    }
    if (cert.currency !== receipt.currency) {
      throw new BadRequestException(
        `Currency mismatch: receipt is ${receipt.currency} but certificate is ${cert.currency}`,
      );
    }

    // Guard: allocated amount must be positive.
    if (new Decimal(dto.allocatedAmount).lessThanOrEqualTo(0)) {
      throw new BadRequestException('allocatedAmount must be greater than zero');
    }

    // Guard: total allocated must not exceed receipt amount.
    const alreadyAllocated = await this.repo.getTotalAllocated(prisma, receiptId);
    const receiptAmount = new Decimal(receipt.amount.toString());
    const alreadyAllocatedDec = new Decimal(alreadyAllocated);
    const newAllocation = new Decimal(dto.allocatedAmount);
    const afterAllocation = alreadyAllocatedDec.add(newAllocation);

    if (afterAllocation.greaterThan(receiptAmount)) {
      throw new BadRequestException(
        `Allocation of ${newAllocation.toFixed(2)} would exceed receipt amount ${receiptAmount.toFixed(2)}. ` +
        `Available unallocated balance: ${receiptAmount.sub(alreadyAllocatedDec).toFixed(2)}.`,
      );
    }

    return this.repo.addAllocation(prisma, {
      receiptId,
      certificateId: dto.certificateId,
      allocatedAmount: dto.allocatedAmount,
      allocatedBy: identity.userId,
    });
  }

  async removeAllocation(identity: RequestIdentity, receiptId: string, allocationId: string) {
    const prisma = this.tenancyService.getClient();
    await this.requireReceipt(prisma, identity.activeOrganizationId, receiptId);

    const allocation = await this.repo.findAllocation(prisma, allocationId);
    if (!allocation || allocation.receiptId !== receiptId) {
      throw new NotFoundException(`Allocation ${allocationId} not found on this receipt`);
    }

    return this.repo.removeAllocation(prisma, allocationId);
  }

  async getCertificatePaymentStatus(identity: RequestIdentity, certificateId: string) {
    const prisma = this.tenancyService.getClient();

    const cert = await prisma.interimPaymentCertificate.findFirst({
      where: { id: certificateId, organizationId: identity.activeOrganizationId },
      select: { id: true },
    });
    if (!cert) throw new NotFoundException(`Certificate ${certificateId} not found`);

    return this.repo.getCertificatePaymentSummary(prisma, certificateId);
  }

  private async requireReceipt(
    prisma: ReturnType<TenancyService['getClient']>,
    organizationId: string,
    id: string,
  ) {
    const receipt = await this.repo.findById(prisma, organizationId, id);
    if (!receipt) throw new NotFoundException(`PaymentReceipt ${id} not found`);
    return receipt;
  }
}
