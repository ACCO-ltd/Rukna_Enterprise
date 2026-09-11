import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { JwtPayload, PermissionKey } from '@erp/types';

import {
  REQUIRED_PERMISSIONS_KEY,
  REQUIRED_ANY_PERMISSION_KEY,
} from '../decorators/require-permissions.decorator.js';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<PermissionKey[]>(REQUIRED_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // ADR-029 §8 A-1 — an OR set: any one of these authorizes the handler. Evaluated independently
    // of the AND set above so a route can require both (e.g. a class-level AND plus a method OR).
    const requiredAny = this.reflector.getAllAndOverride<PermissionKey[]>(
      REQUIRED_ANY_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required?.length && !requiredAny?.length) return true;

    const user = context.switchToHttp().getRequest<{ user?: JwtPayload }>().user;
    if (!user) {
      throw new UnauthorizedException('Authentication is required for this operation');
    }

    const granted = new Set(user.permissions ?? []);

    if (required?.length) {
      const missing = required.filter((permission) => !granted.has(permission));
      if (missing.length > 0) {
        throw new ForbiddenException(`Missing required permission: ${missing.join(', ')}`);
      }
    }

    if (requiredAny?.length) {
      const satisfied = requiredAny.some((permission) => granted.has(permission));
      if (!satisfied) {
        throw new ForbiddenException(
          `Missing required permission: one of ${requiredAny.join(', ')}`,
        );
      }
    }

    return true;
  }
}
