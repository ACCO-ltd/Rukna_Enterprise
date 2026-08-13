import { randomUUID } from 'crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import type { Prisma } from '@prisma/client';

import type { JwtPayload } from '@erp/types';

import { TenancyService } from '../../tenancy/tenancy.service.js';
import { tenancyStorage } from '../../tenancy/tenancy.context.js'; // TenantContext (slug/id only)
import type { LoginDto } from '../presentation/dto/login.dto.js';
import { AuditLogsService } from '../../audit-logs/application/audit-logs.service.js';

// Internal pair returned from service to controller; controller sets the cookie.
interface TokenPairInternal {
  accessToken: string;
  refreshToken: string;
}

const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const membershipInclude = {
  roles: {
    where: { removedAt: null },
    include: {
      role: {
        include: { rolePermissions: { include: { permission: true } } },
      },
    },
  },
} satisfies Prisma.OrganizationMembershipInclude;

type AuthMembership = Prisma.OrganizationMembershipGetPayload<{
  include: typeof membershipInclude;
}>;

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly tenancyService: TenancyService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async login(dto: LoginDto, deviceHint?: string): Promise<TokenPairInternal> {
    const prisma = this.tenancyService.getClient();
    const ctx = tenancyStorage.getStore()!;

    const user = await prisma.user.findUnique({
      where: { email: dto.email },
      include: {
        memberships: {
          where: { status: 'ACTIVE' },
          orderBy: [{ isDefault: 'desc' }, { joinedAt: 'asc' }],
          include: membershipInclude,
        },
      },
    });

    const membership = user?.memberships[0];
    if (!user || user.status !== 'ACTIVE' || !membership) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const payload = this.buildPayload(user, membership, ctx.tenantSlug);
    const accessToken = this.jwtService.sign(payload);

    const jti = randomUUID();
    const tokenFamilyId = randomUUID();
    const refreshToken = this.signRefreshToken(payload, jti);
    const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);

    await prisma.refreshToken.create({
      data: { jti, tokenFamilyId, userId: user.id, expiresAt, deviceHint },
    });
    await this.auditLogs.log({
      userId: user.id,
      orgId: membership.organizationId,
      action: 'LOGIN',
      resource: 'session',
      resourceId: jti,
    });

    return { accessToken, refreshToken };
  }

  async refresh(rawRefreshToken: string, deviceHint?: string): Promise<TokenPairInternal> {
    const prisma = this.tenancyService.getClient();
    const ctx = tenancyStorage.getStore()!;

    // Verify signature and expiry
    let payload: JwtPayload & { jti?: string };
    try {
      payload = this.jwtService.verify<JwtPayload & { jti?: string }>(rawRefreshToken, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (!payload.jti) {
      throw new UnauthorizedException('Malformed refresh token');
    }
    if (payload.tenantSlug !== ctx.tenantSlug) {
      throw new UnauthorizedException('Refresh token tenant mismatch');
    }

    // O(1) lookup by jti
    const stored = await prisma.refreshToken.findUnique({ where: { jti: payload.jti } });

    if (!stored || stored.userId !== payload.sub || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token invalid or expired');
    }

    // Reuse detection — revoke entire family if this token was already used
    if (stored.revokedAt !== null) {
      await prisma.refreshToken.updateMany({
        where: { tokenFamilyId: stored.tokenFamilyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Refresh token reuse detected — all sessions revoked');
    }

    // Revoke the consumed token
    await prisma.refreshToken.update({
      where: { jti: payload.jti },
      data: { revokedAt: new Date() },
    });

    // Re-fetch user for fresh roles/permissions
    const membership = await prisma.organizationMembership.findFirst({
      where: {
        userId: payload.sub,
        organizationId: payload.orgId,
        status: 'ACTIVE',
        user: { status: 'ACTIVE' },
      },
      include: {
        ...membershipInclude,
        user: true,
      },
    });

    if (!membership) {
      throw new UnauthorizedException('User or organization membership is inactive');
    }

    const newPayload = this.buildPayload(membership.user, membership, ctx.tenantSlug);
    const accessToken = this.jwtService.sign(newPayload);

    // Rotate: new jti, same family
    const newJti = randomUUID();
    const refreshToken = this.signRefreshToken(newPayload, newJti);
    const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);

    await prisma.refreshToken.create({
      data: {
        jti: newJti,
        tokenFamilyId: stored.tokenFamilyId,
        userId: membership.user.id,
        expiresAt,
        deviceHint,
      },
    });
    await this.auditLogs.log({
      userId: membership.user.id,
      orgId: membership.organizationId,
      action: 'REFRESH',
      resource: 'session',
      resourceId: newJti,
    });

    return { accessToken, refreshToken };
  }

  async logout(rawRefreshToken: string | undefined): Promise<void> {
    if (!rawRefreshToken) return;

    const prisma = this.tenancyService.getClient();

    let payload: JwtPayload & { jti?: string };
    try {
      // ignoreExpiration: allow logout with an expired token
      payload = this.jwtService.verify<JwtPayload & { jti?: string }>(rawRefreshToken, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
        ignoreExpiration: true,
      });
    } catch {
      return; // invalid signature — treat as already logged out
    }

    if (!payload.jti) return;

    const revoked = await prisma.refreshToken.updateMany({
      where: { jti: payload.jti, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (revoked.count > 0) {
      await this.auditLogs.log({
        userId: payload.sub,
        orgId: payload.orgId,
        action: 'LOGOUT',
        resource: 'session',
        resourceId: payload.jti,
      });
    }
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private buildPayload(
    user: {
      id: string;
      email: string;
      preferredLanguage: string;
    },
    membership: AuthMembership,
    tenantSlug: string,
  ): JwtPayload {
    const scopedAssignments = membership.roles.filter(
      (assignment) => assignment.role.organizationId === membership.organizationId,
    );
    const roles = [...new Set(scopedAssignments.map((assignment) => assignment.role.name))];
    const permissions = [
      ...new Set(
        scopedAssignments.flatMap((assignment) =>
          assignment.role.rolePermissions.map(
            (rolePermission) =>
              `${rolePermission.permission.action}:${rolePermission.permission.resource}`,
          ),
        ),
      ),
    ];
    const lang: 'en' | 'ar' = user.preferredLanguage === 'AR' ? 'ar' : 'en';

    return {
      sub: user.id,
      email: user.email,
      orgId: membership.organizationId,
      tenantSlug,
      roles,
      permissions,
      lang,
    };
  }

  private signRefreshToken(payload: JwtPayload, jti: string): string {
    return this.jwtService.sign(
      { ...payload, jti },
      {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: (this.config.get<string>('JWT_REFRESH_EXPIRES') ?? '7d') as never,
      },
    );
  }
}
