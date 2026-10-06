import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Observable, from } from 'rxjs';
import { concatMap, map } from 'rxjs/operators';
import type { RequestIdentity } from '@erp/types';

import { NO_AUDIT_KEY } from '../../../common/decorators/no-audit.decorator.js';
import { AuditLogsService } from './audit-logs.service.js';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly auditLogs: AuditLogsService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request & { user?: RequestIdentity }>();
    if (READ_METHODS.has(request.method) || !request.user || request.path.startsWith('/auth/')) {
      return next.handle();
    }
    if (this.reflector.getAllAndOverride<boolean>(NO_AUDIT_KEY, [context.getHandler(), context.getClass()])) {
      return next.handle();
    }

    return next.handle().pipe(
      concatMap((result) =>
        from(
          this.auditLogs.log({
            userId: request.user!.userId,
            orgId: request.user!.activeOrganizationId,
            action: request.method,
            resource: this.resourceName(request),
            resourceId: this.resourceId(request),
            ipAddress: request.ip,
            reason: this.reason(request),
          }),
        ).pipe(map(() => result)),
      ),
    );
  }

  private resourceName(request: Request): string {
    const routePath = (request.route as { path?: string } | undefined)?.path ?? request.path;
    return `${request.baseUrl}${routePath}`.replace(/\/+/g, '/').slice(0, 255);
  }

  /** A command's stated reason, when its body carries one — kept so the history says why. */
  private reason(request: Request): string | undefined {
    const body = request.body as { reason?: unknown } | undefined;
    return typeof body?.reason === 'string' && body.reason.trim() ? body.reason.trim().slice(0, 1000) : undefined;
  }

  private resourceId(request: Request): string {
    const params = request.params as Record<string, string>;
    return params['id'] ?? params['projectId'] ?? params['billId'] ?? params['poId'] ?? 'collection';
  }
}
