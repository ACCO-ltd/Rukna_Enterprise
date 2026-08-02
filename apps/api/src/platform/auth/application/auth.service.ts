import { randomUUID } from 'crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';

import type { JwtPayload } from '@erp/types';

import { TenancyService } from '../../tenancy/tenancy.service.js';
import { tenancyStorage } from '../../tenancy/tenancy.context.js'; // TenantContext (slug/id only)
import type { LoginDto } from '../presentation/dto/login.dto.js';

// Internal pair returned from service to controller; controller sets the cookie.
interface TokenPairInternal {
  accessToken: string;
  refreshToken: string;
}

const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly tenancyService: TenancyService,
  ) {}

  async login(dto: LoginDto, deviceHint?: string): Promise<TokenPairInternal> {
    const prisma = this.tenancyService.getClient();
    const ctx = tenancyStorage.getStore()!;

    const user = await prisma.user.findUnique({
      where: { email: dto.email },
      include: {
        userRoles: {
          include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
        },
      },
    });

    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const payload = this.buildPayload(user, ctx.tenantSlug);
    const accessToken = this.jwtService.sign(payload);

    const jti = randomUUID();
    const tokenFamilyId = randomUUID();
    const refreshToken = this.signRefreshToken(payload, jti);
    const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);

    await prisma.refreshToken.create({
      data: { jti, tokenFamilyId, userId: user.id, expiresAt, deviceHint },
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
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        userRoles: {
          include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
        },
      },
    });

    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('User not found or inactive');
    }

    const newPayload = this.buildPayload(user, ctx.tenantSlug);
    const accessToken = this.jwtService.sign(newPayload);

    // Rotate: new jti, same family
    const newJti = randomUUID();
    const refreshToken = this.signRefreshToken(newPayload, newJti);
    const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);

    await prisma.refreshToken.create({
      data: { jti: newJti, tokenFamilyId: stored.tokenFamilyId, userId: user.id, expiresAt, deviceHint },
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

    await prisma.refreshToken.updateMany({
      where: { jti: payload.jti, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private buildPayload(
    user: {
      id: string;
      email: string;
      organizationId: string;
      preferredLanguage: string;
      userRoles: Array<{
        role: {
          name: string;
          rolePermissions: Array<{ permission: { action: string; resource: string } }>;
        };
      }>;
    },
    tenantSlug: string,
  ): JwtPayload {
    const roles = user.userRoles.map((ur) => ur.role.name);
    const permissions = [
      ...new Set(
        user.userRoles.flatMap((ur) =>
          ur.role.rolePermissions.map((rp) => `${rp.permission.action}:${rp.permission.resource}`),
        ),
      ),
    ];
    const lang: 'en' | 'ar' = user.preferredLanguage === 'AR' ? 'ar' : 'en';

    return {
      sub: user.id,
      email: user.email,
      orgId: user.organizationId,
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
