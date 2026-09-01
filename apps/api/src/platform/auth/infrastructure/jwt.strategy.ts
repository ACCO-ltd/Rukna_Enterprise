import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

import type { JwtPayload, RequestIdentity } from '@erp/types';
import { TenancyService } from '../../tenancy/tenancy.service.js';
import { tenancyStorage } from '../../tenancy/tenancy.context.js';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly tenancyService: TenancyService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_ACCESS_SECRET') ?? '',
    });
  }

  async validate(payload: JwtPayload): Promise<RequestIdentity> {
    if (!payload.sub) throw new UnauthorizedException();

    // ARCH-SEC-002: cross-tenant token replay protection
    const ctx = tenancyStorage.getStore();
    if (!ctx) throw new UnauthorizedException('No tenant context');
    if (payload.tenantSlug !== ctx.tenantSlug) {
      throw new UnauthorizedException('Token tenant mismatch');
    }

    // ARCH-ORG-004: every authenticated request validates active org membership
    const prisma = this.tenancyService.getClient();
    const membership = await prisma.organizationMembership.findFirst({
      where: {
        userId: payload.sub,
        organizationId: payload.orgId,
        status: 'ACTIVE',
        user: { status: 'ACTIVE' },
      },
      select: {
        id: true,
        user: {
          select: {
            mustChangePassword: true,
            temporaryPasswordExpiresAt: true,
            sessionVersion: true,
          },
        },
      },
    });
    if (!membership) {
      throw new UnauthorizedException('No active organization membership');
    }
    if (
      membership.user.mustChangePassword &&
      membership.user.temporaryPasswordExpiresAt &&
      membership.user.temporaryPasswordExpiresAt <= new Date()
    ) {
      throw new UnauthorizedException('Temporary password has expired; contact an administrator');
    }
    if (payload.sessionVersion !== membership.user.sessionVersion) {
      throw new UnauthorizedException('Session has been invalidated');
    }

    return {
      userId: payload.sub,
      activeOrganizationId: payload.orgId,
      tenantSlug: payload.tenantSlug,
      roles: payload.roles,
      permissions: payload.permissions,
      // Server state, rather than a potentially stale JWT claim, controls this gate.
      mustChangePassword: membership.user.mustChangePassword,
    };
  }
}
