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
 * These two lists are INDEPENDENT of `ProjectAccessService`'s access-bypass set in CODE — do NOT
 * couple them. Who-can-open-a-project (authorization) and who-gets-pinged-about-its-money (this) are
 * different questions; narrowing the audience must never touch authorization. Under-notifying is the
 * safe direction.
 *
 * Note: under the revised role scheme every org-role recipient here (Finance Officer, CFO, CEO,
 * ADMIN) also happens to be in the access-bypass set, so they can open any project the alert links
 * to — the earlier "alert to a screen you can't open" caveat no longer applies to org roles. The
 * project-role recipients are project members by definition, so they can open their project too.
 */
// ACCO's configured Role.name values under the revised role scheme (2026-09-15): the finance
// function is now the single `Finance Officer` (merged Finance & Commercial + Accounting), plus
// finance/exec leadership (CFO, CEO — governed roles) and platform ADMIN. Construction / Procurement
// / Site roles are excluded: overdue money is a finance concern.
// ⚠ `Finance Officer` is a CUSTOM, admin-editable name — renaming it in Admin → Roles silently stops
// this filter matching it. A permission-based audience (holders of receivables-management /
// financial-position visibility) would be rename-proof; deferred as a future robustness step.
const MONEY_NOTIFICATION_ORG_ROLES = [
  // finance function
  'Finance Officer',
  // finance / exec leadership + platform admin
  'CFO',
  'CEO',
  'ADMIN',
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
