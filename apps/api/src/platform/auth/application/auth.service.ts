import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';

import type { JwtPayload, TokenPair } from '@erp/types';

import { TenancyService } from '../../tenancy/tenancy.service.js';
import { tenancyStorage } from '../../tenancy/tenancy.context.js';
import type { LoginDto } from '../presentation/dto/login.dto.js';
import type { RefreshTokenDto } from '../presentation/dto/refresh-token.dto.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly tenancyService: TenancyService,
  ) {}

  async login(dto: LoginDto): Promise<TokenPair> {
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

    const roles = user.userRoles.map((ur) => ur.role.name) as string[];
    const permissions = [
      ...new Set(
        user.userRoles.flatMap((ur) =>
          ur.role.rolePermissions.map((rp) => `${rp.permission.action}:${rp.permission.resource}`),
        ),
      ),
    ] as string[];

    const lang: 'en' | 'ar' = user.preferredLanguage === 'AR' ? 'ar' : 'en';

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      orgId: user.organizationId,
      tenantSlug: ctx.slug,
      roles,
      permissions,
      lang,
    };

    const accessToken = this.jwtService.sign(payload);
    const refreshToken = this.jwtService.sign(payload, {
      secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      expiresIn: (this.config.get<string>('JWT_REFRESH_EXPIRES') ?? '7d') as never,
    });

    const tokenHash = await bcrypt.hash(refreshToken, 10);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await prisma.refreshToken.create({
      data: { token: tokenHash, userId: user.id, expiresAt },
    });

    return { accessToken, refreshToken };
  }

  async refresh(dto: RefreshTokenDto): Promise<Pick<TokenPair, 'accessToken'>> {
    const prisma = this.tenancyService.getClient();
    const ctx = tenancyStorage.getStore()!;

    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(dto.refreshToken, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokens = await prisma.refreshToken.findMany({
      where: { userId: payload.sub, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    let matchedToken: (typeof tokens)[0] | undefined;
    for (const t of tokens) {
      if (new Date(t.expiresAt) > new Date() && (await bcrypt.compare(dto.refreshToken, t.token))) {
        matchedToken = t;
        break;
      }
    }

    if (!matchedToken) {
      throw new UnauthorizedException('Refresh token revoked or expired');
    }

    await prisma.refreshToken.update({
      where: { id: matchedToken.id },
      data: { revokedAt: new Date() },
    });

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

    const roles = user.userRoles.map((ur) => ur.role.name) as string[];
    const permissions = [
      ...new Set(
        user.userRoles.flatMap((ur) =>
          ur.role.rolePermissions.map((rp) => `${rp.permission.action}:${rp.permission.resource}`),
        ),
      ),
    ] as string[];

    const lang: 'en' | 'ar' = user.preferredLanguage === 'AR' ? 'ar' : 'en';

    const newPayload: JwtPayload = {
      sub: user.id,
      email: user.email,
      orgId: user.organizationId,
      tenantSlug: ctx.slug,
      roles,
      permissions,
      lang,
    };

    const accessToken = this.jwtService.sign(newPayload);
    return { accessToken };
  }

  async logout(dto: RefreshTokenDto): Promise<void> {
    const prisma = this.tenancyService.getClient();

    const tokens = await prisma.refreshToken.findMany({
      where: { revokedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    for (const t of tokens) {
      if (await bcrypt.compare(dto.refreshToken, t.token)) {
        await prisma.refreshToken.update({
          where: { id: t.id },
          data: { revokedAt: new Date() },
        });
        return;
      }
    }
  }
}
