import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { PERMISSIONS, type JwtPayload, type PermissionKey } from '@erp/types';

import { PermissionsGuard } from './permissions.guard.js';
import {
  REQUIRED_PERMISSIONS_KEY,
  REQUIRED_ANY_PERMISSION_KEY,
} from '../decorators/require-permissions.decorator.js';

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
});

/**
 * The guard reads two metadata keys (AND + OR). This reflector answers each key independently so a
 * test can set the AND set, the OR set, or both, the way the two decorators do at runtime.
 */
const reflectorFor = (opts: {
  all?: PermissionKey[];
  any?: PermissionKey[];
}): Reflector =>
  ({
    getAllAndOverride: (key: string) =>
      key === REQUIRED_ANY_PERMISSION_KEY ? opts.any : opts.all,
  }) as unknown as Reflector;

describe('PermissionsGuard', () => {
  it('allows routes without permission metadata', () => {
    expect(new PermissionsGuard(reflectorFor({})).canActivate(contextWith())).toBe(true);
  });

  it('allows a user who has every required permission', () => {
    const required: PermissionKey[] = [PERMISSIONS.projectsView, PERMISSIONS.projectsManage];
    expect(
      new PermissionsGuard(reflectorFor({ all: required })).canActivate(
        contextWith(payload(required)),
      ),
    ).toBe(true);
  });

  it('denies a user missing any required permission', () => {
    expect(() =>
      new PermissionsGuard(
        reflectorFor({ all: [PERMISSIONS.projectsView, PERMISSIONS.projectsManage] }),
      ).canActivate(contextWith(payload([PERMISSIONS.projectsView]))),
    ).toThrow(ForbiddenException);
  });

  it('denies permission-protected routes without an authenticated principal', () => {
    expect(() =>
      new PermissionsGuard(reflectorFor({ all: [PERMISSIONS.projectsView] })).canActivate(
        contextWith(),
      ),
    ).toThrow(UnauthorizedException);
  });

  // ─── ADR-029 §8 A-1 — RequireAnyPermission (OR umbrella) ─────────────────────────
  //
  // A BOQ edit is authorized by edit-scope:boq OR edit-cost:boq OR the manage:boq umbrella.

  const boqEditAny: PermissionKey[] = [
    PERMISSIONS.boqEditScope,
    PERMISSIONS.boqEditCost,
    PERMISSIONS.boqManage,
  ];

  it('A-1: allows an edit when the caller holds edit-scope:boq alone', () => {
    expect(
      new PermissionsGuard(reflectorFor({ any: boqEditAny })).canActivate(
        contextWith(payload([PERMISSIONS.boqEditScope])),
      ),
    ).toBe(true);
  });

  it('A-1: allows an edit when the caller holds edit-cost:boq alone', () => {
    expect(
      new PermissionsGuard(reflectorFor({ any: boqEditAny })).canActivate(
        contextWith(payload([PERMISSIONS.boqEditCost])),
      ),
    ).toBe(true);
  });

  it('A-1: allows an edit under the backward-compatible manage:boq umbrella', () => {
    expect(
      new PermissionsGuard(reflectorFor({ any: boqEditAny })).canActivate(
        contextWith(payload([PERMISSIONS.boqManage])),
      ),
    ).toBe(true);
  });

  it('A-1: denies an edit (403) when the caller holds none of the edit caps', () => {
    expect(() =>
      new PermissionsGuard(reflectorFor({ any: boqEditAny })).canActivate(
        contextWith(payload([PERMISSIONS.boqView])),
      ),
    ).toThrow(ForbiddenException);
  });

  it('enforces the AND set and the OR set together when both are present', () => {
    const reflector = reflectorFor({ all: [PERMISSIONS.boqView], any: boqEditAny });
    // Has the AND (view) but none of the OR (edit) → denied.
    expect(() =>
      new PermissionsGuard(reflector).canActivate(contextWith(payload([PERMISSIONS.boqView]))),
    ).toThrow(ForbiddenException);
    // Has both → allowed.
    expect(
      new PermissionsGuard(reflector).canActivate(
        contextWith(payload([PERMISSIONS.boqView, PERMISSIONS.boqEditScope])),
      ),
    ).toBe(true);
  });
});
