import { Controller, Post, Body, Req, Res, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiCookieAuth } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { Public } from '../../../common/decorators/public.decorator.js';
import { AuthService } from '../application/auth.service.js';
import { LoginDto } from './dto/login.dto.js';

const COOKIE_NAME = 'refreshToken';
const COOKIE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Public()
@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login — returns access token; sets refresh token as HttpOnly cookie' })
  @ApiResponse({ status: 200, description: 'Returns accessToken. Refresh token set as cookie.' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string }> {
    const deviceHint = this.extractDeviceHint(req);
    const { accessToken, refreshToken } = await this.authService.login(dto, deviceHint);
    this.setRefreshCookie(res, refreshToken);
    return { accessToken };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth(COOKIE_NAME)
  @ApiOperation({ summary: 'Rotate the refresh token cookie and get a new access token' })
  @ApiResponse({ status: 200, description: 'Returns new accessToken. New refresh cookie set.' })
  @ApiResponse({ status: 401, description: 'Refresh token missing, invalid, expired, or reused' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string }> {
    const rawToken = this.extractRefreshCookie(req);
    if (!rawToken) {
      res.status(HttpStatus.UNAUTHORIZED);
      throw new Error('Refresh token cookie missing');
    }
    const deviceHint = this.extractDeviceHint(req);
    const { accessToken, refreshToken } = await this.authService.refresh(rawToken, deviceHint);
    this.setRefreshCookie(res, refreshToken);
    return { accessToken };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth(COOKIE_NAME)
  @ApiOperation({ summary: 'Revoke the refresh token and clear the cookie' })
  @ApiResponse({ status: 200, description: 'Session terminated' })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const rawToken = this.extractRefreshCookie(req);
    await this.authService.logout(rawToken);
    this.clearRefreshCookie(res);
  }

  // ─── Cookie helpers ───────────────────────────────────────────────────────────

  private setRefreshCookie(res: Response, token: string): void {
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env['NODE_ENV'] === 'production',
      sameSite: 'lax',
      path: '/api/v1/auth',
      maxAge: COOKIE_TTL_MS,
    });
  }

  private clearRefreshCookie(res: Response): void {
    res.clearCookie(COOKIE_NAME, {
      httpOnly: true,
      secure: process.env['NODE_ENV'] === 'production',
      sameSite: 'lax',
      path: '/api/v1/auth',
    });
  }

  private extractRefreshCookie(req: Request): string | undefined {
    return (req.cookies as Record<string, string> | undefined)?.[COOKIE_NAME];
  }

  private extractDeviceHint(req: Request): string | undefined {
    const ua = req.headers['user-agent'];
    return ua ? ua.substring(0, 255) : undefined;
  }
}
