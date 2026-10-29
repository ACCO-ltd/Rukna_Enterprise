import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import type { FinanceApprovalSettings, RequestIdentity } from '@erp/types';
import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { TransactionalAuditOutboxService } from '../../../../platform/audit-logs/application/transactional-audit-outbox.service.js';
import { AccountingConfigurationRepository } from '../infrastructure/accounting-configuration.repository.js';
import {
  approvalSettingsProblems,
  DEFAULT_APPROVAL_SETTINGS,
  toApprovalSettings,
  toApprovalSettingsDto,
  type ApprovalSettings,
} from '../domain/approval-settings.js';

@Injectable()
export class AccountingConfigurationService {
  constructor(
    private readonly tenancyService: TenancyService,
    private readonly repo: AccountingConfigurationRepository,
    @Optional() private readonly auditOutbox?: TransactionalAuditOutboxService,
  ) {}

  /**
   * ADR-046 §8 — the optional finance approvals in force. An organisation that never saved them
   * (or has no posting policy row yet) gets the defaults: no extra approvals, payments approved on
   * Save up to the ADR-022 lowest band.
   */
  async getApprovalSettings(organizationId: string): Promise<ApprovalSettings> {
    const policy = await this.repo.getPostingPolicy(this.tenancyService.getClient(), organizationId);
    if (!policy) return DEFAULT_APPROVAL_SETTINGS;
    return {
      invoiceApprovalAbove: policy.invoiceApprovalAbove,
      billApprovalAbove: policy.billApprovalAbove,
      autoPostToleratedBills: policy.autoPostToleratedBills,
      paymentAutoApproveUpTo: policy.paymentAutoApproveUpTo,
      writeOffApprovalAbove: policy.writeOffApprovalAbove,
    };
  }

  async getApprovalSettingsDto(identity: RequestIdentity): Promise<FinanceApprovalSettings> {
    return toApprovalSettingsDto(await this.getApprovalSettings(identity.activeOrganizationId));
  }

  /** Saved whole and audited; every bad field is reported at once (`APPROVAL_SETTINGS_INVALID`). */
  async updateApprovalSettings(identity: RequestIdentity, raw: FinanceApprovalSettings): Promise<FinanceApprovalSettings> {
    // An omitted amount means "never" (null), never "0".
    const input: FinanceApprovalSettings = {
      invoiceApprovalAbove: raw.invoiceApprovalAbove ?? null,
      billApprovalAbove: raw.billApprovalAbove ?? null,
      autoPostToleratedBills: raw.autoPostToleratedBills,
      paymentAutoApproveUpTo: raw.paymentAutoApproveUpTo,
      ...(raw.writeOffApprovalAbove !== undefined ? { writeOffApprovalAbove: raw.writeOffApprovalAbove } : {}),
    };
    const problems = approvalSettingsProblems(input);
    if (problems.length > 0) {
      throw new BadRequestException({ errorCode: 'APPROVAL_SETTINGS_INVALID', message: problems.join(' '), details: { problems } });
    }
    const orgId = identity.activeOrganizationId;
    const current = await this.getApprovalSettings(orgId);
    const before = toApprovalSettingsDto(current);
    const next = toApprovalSettings(input, current);
    const prisma = this.tenancyService.getClient();
    await prisma.$transaction(async (tx) => {
      await this.repo.upsertApprovalSettings(tx as never, orgId, { ...next, updatedBy: identity.userId });
      await this.auditOutbox?.record(tx as never, {
        organizationId: orgId,
        actorUserId: identity.userId,
        action: 'UPDATE',
        resourceType: 'PostingPolicy',
        resourceId: orgId,
        sourceCommand: 'accounting.updateApprovalSettings',
        eventType: 'FINANCE_APPROVAL_SETTINGS_UPDATED',
        idempotencyKey: `approval-settings:${orgId}:${Date.now()}`,
        before: before as never,
        after: toApprovalSettingsDto(next) as never,
      });
    });
    return toApprovalSettingsDto(next);
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

  // ADR-024: single-currency — the base currency is always USD.
  getBaseCurrency(_organizationId: string): Promise<string> {
    return Promise.resolve('USD');
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
