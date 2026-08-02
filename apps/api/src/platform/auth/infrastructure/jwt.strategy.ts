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
      where: { userId: payload.sub, organizationId: payload.orgId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!membership) {
      throw new UnauthorizedException('No active organization membership');
    }

    return {
      userId: payload.sub,
      activeOrganizationId: payload.orgId,
      tenantSlug: payload.tenantSlug,
      roles: payload.roles,
      permissions: payload.permissions,
      lang: payload.lang,
    };
  }
}
