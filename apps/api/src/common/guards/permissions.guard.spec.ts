import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { PERMISSIONS, type JwtPayload, type PermissionKey } from '@erp/types';

import { PermissionsGuard } from './permissions.guard.js';

const contextWith = (user?: JwtPayload): ExecutionContext =>
  ({
    getHandler: () => contextWith,
    getClass: () => PermissionsGuard,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

const payload = (permissions: PermissionKey[]): JwtPayload => ({
  sub: 'user-1',
  email: 'admin@acco.test',
  orgId: 'org-1',
  tenantSlug: 'acco',
  roles: ['ADMIN'],
  permissions,
  lang: 'en',
});

describe('PermissionsGuard', () => {
  it('allows routes without permission metadata', () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(undefined) } as unknown as Reflector;
    expect(new PermissionsGuard(reflector).canActivate(contextWith())).toBe(true);
  });

  it('allows a user who has every required permission', () => {
    const required: PermissionKey[] = [PERMISSIONS.projectsView, PERMISSIONS.projectsManage];
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(required) } as unknown as Reflector;
    expect(new PermissionsGuard(reflector).canActivate(contextWith(payload(required)))).toBe(true);
  });

  it('denies a user missing any required permission', () => {
    const reflector = {
      getAllAndOverride: jest
        .fn()
        .mockReturnValue([PERMISSIONS.projectsView, PERMISSIONS.projectsManage]),
    } as unknown as Reflector;
    expect(() =>
      new PermissionsGuard(reflector).canActivate(contextWith(payload([PERMISSIONS.projectsView]))),
    ).toThrow(ForbiddenException);
  });

  it('denies permission-protected routes without an authenticated principal', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue([PERMISSIONS.projectsView]),
    } as unknown as Reflector;
    expect(() => new PermissionsGuard(reflector).canActivate(contextWith())).toThrow(UnauthorizedException);
  });
});
