import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { RequestIdentity } from '@erp/types';

import { TenancyService } from '../tenancy/tenancy.service.js';

const PROJECT_MEMBERSHIP_BYPASS_ROLES = new Set([
  'ADMIN',
  'ORGANIZATION_ADMINISTRATOR',
  'EXECUTIVE_PORTFOLIO_VIEWER',
  'INTERNAL_AUDITOR',
  'FINANCE_CONTROLLER',
  'SYSTEM_SUPPORT',
]);

@Injectable()
export class ProjectAccessService {
  constructor(private readonly tenancyService: TenancyService) {}

  private hasBypass(identity: RequestIdentity): boolean {
    return identity.roles.some((role) => PROJECT_MEMBERSHIP_BYPASS_ROLES.has(role));
  }

  // undefined = no member-scope filter (bypass role); string = filter collections to this user's projects
  scopedUserId(identity: RequestIdentity): string | undefined {
    return this.hasBypass(identity) ? undefined : identity.userId;
  }

  async accessibleProjectIds(identity: RequestIdentity): Promise<string[] | undefined> {
    if (this.hasBypass(identity)) return undefined;
    const memberships = await this.tenancyService.getClient().projectMember.findMany({
      where: { userId: identity.userId, removedAt: null },
      select: { projectId: true },
    });
    return [...new Set(memberships.map((membership) => membership.projectId))];
  }

  async assertMember(identity: RequestIdentity, projectId: string): Promise<void> {
    const prisma = this.tenancyService.getClient();
    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId: identity.activeOrganizationId },
      select: { id: true },
    });
    if (!project) throw new NotFoundException(`Project ${projectId} not found`);

    if (this.hasBypass(identity)) return;

    const membership = await prisma.projectMember.findFirst({
      where: { projectId, userId: identity.userId, removedAt: null },
      select: { id: true },
    });
    if (!membership) throw new ForbiddenException('You are not a member of this project.');
  }

  async assertContract(identity: RequestIdentity, contractId: string): Promise<void> {
    const contract = await this.tenancyService.getClient().contract.findFirst({
      where: { id: contractId, organizationId: identity.activeOrganizationId },
      select: { projectId: true },
    });
    if (!contract) throw new NotFoundException(`Contract ${contractId} not found`);
    await this.assertMember(identity, contract.projectId);
  }

  async assertApplication(identity: RequestIdentity, applicationId: string): Promise<void> {
    const application = await this.tenancyService.getClient().interimPaymentApplication.findFirst({
      where: { id: applicationId, organizationId: identity.activeOrganizationId },
      select: { contract: { select: { projectId: true } } },
    });
    if (!application) throw new NotFoundException(`IPA ${applicationId} not found`);
    await this.assertMember(identity, application.contract.projectId);
  }

  async assertCertificate(identity: RequestIdentity, certificateId: string): Promise<void> {
    const certificate = await this.tenancyService.getClient().interimPaymentCertificate.findFirst({
      where: { id: certificateId, organizationId: identity.activeOrganizationId },
      select: { application: { select: { contract: { select: { projectId: true } } } } },
    });
    if (!certificate) throw new NotFoundException(`IPC ${certificateId} not found`);
    await this.assertMember(identity, certificate.application.contract.projectId);
  }
}
