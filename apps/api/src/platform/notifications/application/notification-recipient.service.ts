import { Injectable } from '@nestjs/common';
import type { PrismaClient, ProjectRole } from '@prisma/client';

/**
 * ADR-031 — recipient resolution for a project-scoped "money you're owed" notification.
 *
 * This is a NOTIFICATION AUDIENCE, not an authorization check. The alerts (stage due/overdue, client
 * invoice overdue) are a finance concern, so the audience is deliberately narrowed to FINANCE +
 * LEADERSHIP:
 *   - active org-role holders in `MONEY_NOTIFICATION_ORG_ROLES` (finance team + leadership oversight), ∪
 *   - active project members holding a finance/commercial PROJECT role (`MONEY_NOTIFICATION_PROJECT_ROLES`).
 * Site engineers, project managers, quantity surveyors and viewers no longer receive money pings.
 *
 * These two lists are INDEPENDENT of `ProjectAccessService`'s access-bypass set — do NOT keep them in
 * sync. Who-can-open-a-project (authorization) and who-gets-pinged-about-its-money (this) are different
 * questions; narrowing the audience must never touch authorization. Under-notifying is the safe direction.
 *
 * Caveat: an org finance/leadership holder who is neither in the access-bypass set nor a project member
 * (e.g. FINANCE_OFFICER, ACCOUNTANT, CFO, CEO) may receive an alert linking to a project screen they
 * cannot open. That is an access-config follow-up, not a leak here — the notification carries only a
 * contract number, stage name and day count, never an amount.
 */
const MONEY_NOTIFICATION_ORG_ROLES = [
  // finance team
  'CFO',
  'FINANCE_OFFICER',
  'ACCOUNTANT',
  'FINANCE_CONTROLLER',
  // leadership / oversight
  'CEO',
  'ADMIN',
  'ORGANIZATION_ADMINISTRATOR',
  'EXECUTIVE_PORTFOLIO_VIEWER',
];

const MONEY_NOTIFICATION_PROJECT_ROLES: ProjectRole[] = ['COMMERCIAL_MANAGER', 'FINANCE_REVIEWER'];

@Injectable()
export class NotificationRecipientService {
  /**
   * The set of userIds that should receive a money notification about `projectId` in `organizationId`:
   * active project members holding a finance/commercial project role ∪ active org finance/leadership
   * holders. `prisma` is passed in (not read from TenancyService) so the generator can call this inside
   * its own tenant `AsyncLocalStorage` context.
   */
  async resolveForProject(
    prisma: PrismaClient,
    organizationId: string,
    projectId: string,
  ): Promise<string[]> {
    const [members, orgHolders] = await Promise.all([
      prisma.projectMember.findMany({
        where: {
          projectId,
          removedAt: null,
          roles: {
            some: {
              removedAt: null,
              role: { in: MONEY_NOTIFICATION_PROJECT_ROLES },
            },
          },
        },
        select: { userId: true },
      }),
      this.resolveOrgRoleHolders(prisma, organizationId),
    ]);

    const recipients = new Set<string>(orgHolders);
    for (const member of members) recipients.add(member.userId);
    return [...recipients];
  }

  /**
   * Org users holding a finance/leadership role via an ACTIVE membership (the same path login uses:
   * OrganizationMembership → OrganizationMembershipRole → Role.name). Returns userIds.
   */
  private async resolveOrgRoleHolders(
    prisma: PrismaClient,
    organizationId: string,
  ): Promise<string[]> {
    const memberships = await prisma.organizationMembership.findMany({
      where: {
        organizationId,
        status: 'ACTIVE',
        removedAt: null,
        roles: {
          some: {
            removedAt: null,
            role: { name: { in: MONEY_NOTIFICATION_ORG_ROLES } },
          },
        },
      },
      select: { userId: true },
    });
    return memberships.map((membership) => membership.userId);
  }
}
