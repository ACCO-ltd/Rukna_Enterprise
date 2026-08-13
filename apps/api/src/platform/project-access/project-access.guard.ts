import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { RequestIdentity } from '@erp/types';

import { PROJECT_ID_PARAM_KEY } from '../../common/decorators/project-scoped.decorator.js';
import { ProjectAccessService } from './project-access.service.js';

@Injectable()
export class ProjectAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const parameterName = this.reflector.getAllAndOverride<string>(PROJECT_ID_PARAM_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!parameterName) return true;

    const request = context.switchToHttp().getRequest<{
      user: RequestIdentity;
      params: Record<string, string | undefined>;
    }>();
    const projectId = request.params[parameterName];
    // Collection/create routes on a class-scoped controller do not carry a project identifier.
    if (!projectId) return true;

    await this.projectAccess.assertMember(request.user, projectId);
    return true;
  }
}
