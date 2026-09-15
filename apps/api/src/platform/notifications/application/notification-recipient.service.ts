import { Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

/**
 * ADR-031 — recipient resolution for a project-scoped notification.
 *
 * A notification must never reach someone who could not open the screen it points at, so this reuses
 * the SAME access model as `ProjectAccessService`: a project's audience is its active members UNION the
 * holders of an org-wide bypass role (finance controller, org admin, auditor, …) who can see every
 * project without an explicit membership. Under-notifying is the safe direction; a person who can act
 * on a due stage but is not on the recipient list simply does not get a bell item — they never get one
 * for a project they cannot access.
 *
 * The bypass set is intentionally duplicated from `ProjectAccessService` (it is a private const there).
 * Keep the two in sync — if a role is added to the authorization bypass, add it here or that role stops
 * receiving portfolio-wide notifications.
 */
const PROJECT_MEMBERSHIP_BYPASS_ROLES = [
  'ADMIN',
  'ORGANIZATION_ADMINISTRATOR',
  'EXECUTIVE_PORTFOLIO_VIEWER',
  'INTERNAL_AUDITOR',
  'FINANCE_CONTROLLER',
  'SYSTEM_SUPPORT',
];

@Injectable()
export class NotificationRecipientService {
  /**
   * The set of userIds that should receive a notification about `projectId` in `organizationId`:
   * active project members ∪ active org bypass-role holders. `prisma` is passed in (not read from
   * TenancyService) so the generator can call this inside its own tenant `AsyncLocalStorage` context.
   */
  async resolveForProject(
    prisma: PrismaClient,
    organizationId: string,
    projectId: string,
  ): Promise<string[]> {
    const [members, bypassHolders] = await Promise.all([
      prisma.projectMember.findMany({
        where: { projectId, removedAt: null },
        select: { userId: true },
      }),
      this.resolveBypassRoleHolders(prisma, organizationId),
    ]);

    const recipients = new Set<string>(bypassHolders);
    for (const member of members) recipients.add(member.userId);
    return [...recipients];
  }

  /**
   * Org users holding a bypass role via an ACTIVE membership (the same authorization path login uses:
   * OrganizationMembership → OrganizationMembershipRole → Role.name). Returns userIds.
   */
  private async resolveBypassRoleHolders(
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
            role: { name: { in: PROJECT_MEMBERSHIP_BYPASS_ROLES } },
          },
        },
      },
      select: { userId: true },
    });
    return memberships.map((membership) => membership.userId);
  }
}
