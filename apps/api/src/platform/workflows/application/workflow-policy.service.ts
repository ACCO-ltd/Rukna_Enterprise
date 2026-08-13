import { Injectable, NotFoundException } from '@nestjs/common';
import { TenancyService } from '../../tenancy/tenancy.service.js';

/**
 * Resolves approved workflow policy data as-of a business timestamp. Approval
 * services consume this configuration; amounts and role routing never belong in
 * application-service conditionals.
 */
@Injectable()
export class WorkflowPolicyService {
  constructor(private readonly tenancyService: TenancyService) {}

  async getActiveVersion(organizationId: string, policyKey: string, at = new Date()) {
    const prisma = this.tenancyService.getClient();
    return prisma.workflowPolicyVersion.findFirst({
      where: {
        organizationId,
        policyKey,
        status: 'ACTIVE',
        effectiveFrom: { lte: at },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
      },
      include: { rules: { where: { status: 'ACTIVE' }, orderBy: { priority: 'desc' } } },
      orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
    });
  }

  async requireActiveVersion(organizationId: string, policyKey: string, at = new Date()) {
    const version = await this.getActiveVersion(organizationId, policyKey, at);
    if (!version) {
      throw new NotFoundException(
        `No active effective-dated workflow policy exists for '${policyKey}' at ${at.toISOString()}.`,
      );
    }
    return version;
  }
}
