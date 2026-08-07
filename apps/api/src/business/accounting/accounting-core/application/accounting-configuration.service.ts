import { Injectable, NotFoundException } from '@nestjs/common';
import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { AccountingConfigurationRepository } from '../infrastructure/accounting-configuration.repository.js';

@Injectable()
export class AccountingConfigurationService {
  constructor(
    private readonly tenancyService: TenancyService,
    private readonly repo: AccountingConfigurationRepository,
  ) {}

  async getMonetaryPolicy(organizationId: string) {
    const prisma = this.tenancyService.getClient();
    const policy = await this.repo.getMonetaryPolicy(prisma, organizationId);
    if (!policy) throw new NotFoundException(`Monetary policy not configured for org ${organizationId}`);
    return policy;
  }

  async getFiscalCalendarPolicy(organizationId: string) {
    const prisma = this.tenancyService.getClient();
    const policy = await this.repo.getFiscalCalendarPolicy(prisma, organizationId);
    if (!policy) throw new NotFoundException(`Fiscal calendar policy not configured for org ${organizationId}`);
    return policy;
  }

  async getPostingPolicy(organizationId: string) {
    const prisma = this.tenancyService.getClient();
    const policy = await this.repo.getPostingPolicy(prisma, organizationId);
    if (!policy) throw new NotFoundException(`Posting policy not configured for org ${organizationId}`);
    return policy;
  }

  async getTaxPolicy(organizationId: string) {
    const prisma = this.tenancyService.getClient();
    return this.repo.getTaxPolicy(prisma, organizationId);
  }

  async getDimensionPolicy(organizationId: string) {
    const prisma = this.tenancyService.getClient();
    return this.repo.getDimensionPolicy(prisma, organizationId);
  }

  async getBankingPolicy(organizationId: string) {
    const prisma = this.tenancyService.getClient();
    return this.repo.getBankingPolicy(prisma, organizationId);
  }

  async getNumberingPolicy(organizationId: string) {
    const prisma = this.tenancyService.getClient();
    return this.repo.getNumberingPolicy(prisma, organizationId);
  }

  async getBaseCurrency(organizationId: string): Promise<string> {
    return (await this.getMonetaryPolicy(organizationId)).baseCurrencyCode;
  }

  async requiresFourEyes(organizationId: string): Promise<boolean> {
    return (await this.getPostingPolicy(organizationId)).requireFourEyesOnJournals;
  }

  async fiscalYearStartMonth(organizationId: string): Promise<number> {
    return (await this.getFiscalCalendarPolicy(organizationId)).fiscalYearStartMonth;
  }

  async draftJournalsBlockClose(organizationId: string): Promise<boolean> {
    return (await this.getPostingPolicy(organizationId)).draftJournalsBlockPeriodClose;
  }
}
