import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable, from } from 'rxjs';
import { concatMap, map } from 'rxjs/operators';
import type { RequestIdentity } from '@erp/types';

import { AuditLogsService } from './audit-logs.service.js';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly auditLogs: AuditLogsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request & { user?: RequestIdentity }>();
    if (READ_METHODS.has(request.method) || !request.user || request.path.startsWith('/auth/')) {
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
          }),
        ).pipe(map(() => result)),
      ),
    );
  }

  private resourceName(request: Request): string {
    const routePath = (request.route as { path?: string } | undefined)?.path ?? request.path;
    return `${request.baseUrl}${routePath}`.replace(/\/+/g, '/').slice(0, 255);
  }

  private resourceId(request: Request): string {
    const params = request.params as Record<string, string>;
    return params['id'] ?? params['projectId'] ?? params['billId'] ?? params['poId'] ?? 'collection';
  }
}
