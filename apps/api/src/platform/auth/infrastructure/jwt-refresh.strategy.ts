import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

import type { JwtPayload } from '@erp/types';

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(config: ConfigService) {
    super({
      // Extract refresh token from the HttpOnly cookie (not the request body)
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request) => (req.cookies as Record<string, string> | undefined)?.['refreshToken'] ?? null,
      ]),
      ignoreExpiration: false,
      passReqToCallback: true,
      secretOrKey: config.get<string>('JWT_REFRESH_SECRET') ?? '',
    });
  }

  validate(_req: Request, payload: JwtPayload): JwtPayload {
    return payload;
  }
}
