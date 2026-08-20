import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { ProjectScoped } from '../../../../common/decorators/project-scoped.decorator.js';
import { ProjectAccessGuard } from '../../../../platform/project-access/project-access.guard.js';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { CommercialService } from '../application/commercial.service.js';

@ApiTags('Commercial')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, ProjectAccessGuard)
@RequirePermissions(PERMISSIONS.contractsView)
@ProjectScoped('projectId')
@Controller('projects/:projectId/commercial')
export class CommercialController {
  constructor(private readonly commercialService: CommercialService) {}

  @Get('summary')
  @ApiOperation({
    summary: 'Permission-aware commercial summary for a project (ADR-017 §B2)',
  })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  getSummary(@CurrentUser() identity: RequestIdentity, @Param('projectId') projectId: string) {
    return this.commercialService.getSummary(identity, projectId);
  }

  @Get('applications')
  @ApiOperation({
    summary: 'Consolidated IPA → IPC → invoice → settlement chain for a project (ADR-017 §B3)',
  })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  getApplications(@CurrentUser() identity: RequestIdentity, @Param('projectId') projectId: string) {
    return this.commercialService.getApplications(identity, projectId);
  }

  @Get('current-cycle')
  @ApiOperation({ summary: 'Authoritative current commercial cycle and next action' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  getCurrentCycle(@CurrentUser() identity: RequestIdentity, @Param('projectId') projectId: string) {
    return this.commercialService.getCurrentCycle(identity, projectId);
  }
}
