import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

import type { JwtPayload } from '@erp/types';
import { tenancyStorage } from '../../tenancy/tenancy.context.js';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_ACCESS_SECRET') ?? '',
    });
  }

  validate(payload: JwtPayload): JwtPayload {
    if (!payload.sub) throw new UnauthorizedException();

    // ARCH-SEC-002: cross-tenant token replay protection
    const ctx = tenancyStorage.getStore();
    if (!ctx) throw new UnauthorizedException('No tenant context');
    if (payload.tenantSlug !== ctx.slug) {
      throw new UnauthorizedException('Token tenant mismatch');
    }

    return payload;
  }
}
