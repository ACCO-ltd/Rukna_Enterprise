import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type {
  CompanyTemplatesResponse,
  PaymentPlanTemplateRow,
  RequestIdentity,
  ScheduleTemplatePhaseDto,
} from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { TransactionalAuditOutboxService } from '../../../../platform/audit-logs/application/transactional-audit-outbox.service.js';
import { CompanyTemplatesRepository } from '../infrastructure/company-templates.repository.js';
import { DEFAULT_BUILDING_PHASES, DEFAULT_PAYMENT_PLAN } from '../domain/default-templates.js';
import {
  normalisePaymentPlan,
  normaliseSchedule,
  paymentPlanProblems,
  scheduleProblems,
} from '../domain/template-rules.js';

type TemplateKind = 'PAYMENT_PLAN' | 'SCHEDULE';

/**
 * Step 1b (ADR-047): company templates. Rukna ships a default; a company may keep its own copy
 * (validated on save) and reset back to the default. Readers — the contract payment-plan builders
 * and the schedule wizard — always get the template in force via `get` / `schedulePhases`.
 */
@Injectable()
export class CompanyTemplatesService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: CompanyTemplatesRepository,
    @Optional() private readonly auditOutbox?: TransactionalAuditOutboxService,
  ) {}

  async get(identity: RequestIdentity): Promise<CompanyTemplatesResponse> {
    const row = await this.repo.find(this.tenancy.getClient(), identity.activeOrganizationId);
    if (!row) throw new NotFoundException('Organization not found');
    const plan = row.paymentPlanTemplate as PaymentPlanTemplateRow[] | null;
    const phases = row.scheduleTemplate as ScheduleTemplatePhaseDto[] | null;
    return {
      paymentPlan: { rows: plan ?? DEFAULT_PAYMENT_PLAN.map((r) => ({ ...r })), isDefault: plan === null },
      schedule: { phases: phases ?? DEFAULT_BUILDING_PHASES.map((p) => ({ ...p })), isDefault: phases === null },
    };
  }

  /** The building-schedule phases in force for this company (its copy, else the Rukna default). */
  async schedulePhases(organizationId: string): Promise<readonly ScheduleTemplatePhaseDto[]> {
    const row = await this.repo.find(this.tenancy.getClient(), organizationId);
    return (row?.scheduleTemplate as ScheduleTemplatePhaseDto[] | null) ?? DEFAULT_BUILDING_PHASES;
  }

  async savePaymentPlan(identity: RequestIdentity, rows: PaymentPlanTemplateRow[]): Promise<CompanyTemplatesResponse> {
    const problems = paymentPlanProblems(rows);
    if (problems.length > 0) {
      throw new BadRequestException({ errorCode: 'TEMPLATE_INVALID', message: problems.join(' '), details: { problems } });
    }
    await this.write(identity, 'PAYMENT_PLAN', normalisePaymentPlan(rows));
    return this.get(identity);
  }

  async saveSchedule(identity: RequestIdentity, phases: ScheduleTemplatePhaseDto[]): Promise<CompanyTemplatesResponse> {
    const problems = scheduleProblems(phases);
    if (problems.length > 0) {
      throw new BadRequestException({ errorCode: 'TEMPLATE_INVALID', message: problems.join(' '), details: { problems } });
    }
    await this.write(identity, 'SCHEDULE', normaliseSchedule(phases));
    return this.get(identity);
  }

  async reset(identity: RequestIdentity, kind: TemplateKind): Promise<CompanyTemplatesResponse> {
    await this.write(identity, kind, null);
    return this.get(identity);
  }

  private async write(identity: RequestIdentity, kind: TemplateKind, value: unknown[] | null): Promise<void> {
    const orgId = identity.activeOrganizationId;
    const prisma = this.tenancy.getClient();
    await prisma.$transaction(async (tx) => {
      const json = value as Prisma.InputJsonValue | null;
      if (kind === 'PAYMENT_PLAN') await this.repo.setPaymentPlan(tx as never, orgId, json);
      else await this.repo.setSchedule(tx as never, orgId, json);
      await this.auditOutbox?.record(tx as Prisma.TransactionClient, {
        organizationId: orgId,
        actorUserId: identity.userId,
        action: value === null ? 'reset' : 'update',
        resourceType: 'company-template',
        resourceId: `${orgId}:${kind}`,
        sourceCommand: value === null ? 'ResetCompanyTemplate' : 'SaveCompanyTemplate',
        eventType: value === null ? 'COMPANY_TEMPLATE_RESET' : 'COMPANY_TEMPLATE_SAVED',
        idempotencyKey: `company-template:${orgId}:${kind}:${randomUUID()}`,
        after: { kind, value },
      });
    });
  }
}
