import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import type { RequestIdentity } from '@erp/types';
import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { FiscalYearRepository } from '../infrastructure/fiscal-year.repository.js';
import { AccountRepository } from '../infrastructure/account.repository.js';
import { AccountingConfigurationService } from './accounting-configuration.service.js';
import { buildFiscalYearPlan } from '../domain/fiscal-calendar.js';

export interface CreateFiscalYearDto {
  year: number;
  retainedEarningsAccountCode: string;
}

@Injectable()
export class FiscalYearService {
  constructor(
    private readonly tenancyService: TenancyService,
    private readonly repo: FiscalYearRepository,
    private readonly accountRepo: AccountRepository,
    private readonly config: AccountingConfigurationService,
  ) {}

  async create(identity: RequestIdentity, dto: CreateFiscalYearDto) {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId, userId } = identity;

    const calPolicy = await this.config.getFiscalCalendarPolicy(orgId);
    // Shared with the one-step accounting setup (ADR-040) so both cut the year identically.
    const plan = buildFiscalYearPlan(dto.year, calPolicy.fiscalYearStartMonth);

    const existing = await this.repo.findByName(prisma, orgId, plan.name);
    if (existing) throw new ConflictException(`Fiscal year ${plan.name} already exists`);

    const retainedAccount = await this.accountRepo.findByCode(prisma, orgId, dto.retainedEarningsAccountCode);
    if (!retainedAccount) {
      throw new NotFoundException(`Retained earnings account "${dto.retainedEarningsAccountCode}" not found`);
    }

    return this.repo.createWithPeriods(prisma, {
      organizationId: orgId,
      name: plan.name,
      startDate: plan.startDate,
      endDate: plan.endDate,
      retainedEarningsAccountId: retainedAccount.id,
      createdBy: userId,
      periods: plan.periods.map((p) => ({ ...p, organizationId: orgId })),
    });
  }

  async findAll(identity: RequestIdentity) {
    const prisma = this.tenancyService.getClient();
    return this.repo.findAll(prisma, identity.activeOrganizationId);
  }

  async findById(identity: RequestIdentity, id: string) {
    const prisma = this.tenancyService.getClient();
    const fy = await this.repo.findById(prisma, identity.activeOrganizationId, id);
    if (!fy) throw new NotFoundException(`Fiscal year ${id} not found`);
    return fy;
  }

  async findPeriodCovering(identity: RequestIdentity, date: Date) {
    const prisma = this.tenancyService.getClient();
    return this.repo.findPeriodCovering(prisma, identity.activeOrganizationId, date);
  }
}
