import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import type { RequestIdentity } from '@erp/types';
import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { FiscalYearRepository } from '../infrastructure/fiscal-year.repository.js';
import { AccountRepository } from '../infrastructure/account.repository.js';
import { AccountingConfigurationService } from './accounting-configuration.service.js';

export interface CreateFiscalYearDto {
  year: number;
  retainedEarningsAccountCode: string;
}

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

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

    const fyName = `FY${dto.year}`;
    const existing = await this.repo.findByName(prisma, orgId, fyName);
    if (existing) throw new ConflictException(`Fiscal year ${fyName} already exists`);

    const retainedAccount = await this.accountRepo.findByCode(prisma, orgId, dto.retainedEarningsAccountCode);
    if (!retainedAccount) {
      throw new NotFoundException(`Retained earnings account "${dto.retainedEarningsAccountCode}" not found`);
    }

    const calPolicy = await this.config.getFiscalCalendarPolicy(orgId);
    const startMonth = calPolicy.fiscalYearStartMonth;

    const fyStart = new Date(dto.year, startMonth - 1, 1);
    const fyEnd = new Date(dto.year + (startMonth === 1 ? 0 : 1), (startMonth - 2 + 12) % 12, 0);

    const periods = this.buildPeriods(orgId, dto.year, startMonth);

    return this.repo.createWithPeriods(prisma, {
      organizationId: orgId,
      name: fyName,
      startDate: fyStart,
      endDate: fyEnd,
      retainedEarningsAccountId: retainedAccount.id,
      createdBy: userId,
      periods,
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

  private buildPeriods(organizationId: string, year: number, startMonth: number) {
    return Array.from({ length: 12 }, (_, i) => {
      const monthIndex = (startMonth - 1 + i) % 12;
      const periodYear = monthIndex < startMonth - 1 ? year + 1 : year;
      const startDate = new Date(periodYear, monthIndex, 1);
      const endDate = new Date(periodYear, monthIndex + 1, 0);

      return {
        organizationId,
        periodNumber: i + 1,
        name: `${MONTH_NAMES[monthIndex]} ${periodYear}`,
        startDate,
        endDate,
        periodType: 'OPERATING' as const,
        status: 'OPEN' as const,
      };
    });
  }
}
