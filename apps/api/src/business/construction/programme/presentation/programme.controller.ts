import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiParam } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { ProgrammeService } from '../application/programme.service.js';
import { CreateMilestoneDto, VerifyMilestoneDto } from './dto/programme.dto.js';

// ADR-021 phase 2: programme delivery milestones (baseline dates + PLANNED -> VERIFIED).
// Capability gate mirrors the rest of construction (view:project to read, manage:project to
// write); project membership is enforced per-call in the service via projectAccess.assertMember.
// ADR-022 will refine writes to the DPR/programme authority chain.
@ApiTags('Programme')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.projectsView)
@Controller()
export class ProgrammeController {
  constructor(private readonly service: ProgrammeService) {}

  @Post('projects/:projectId/programme/milestones')
  @RequirePermissions(PERMISSIONS.projectsManage)
  @ApiParam({ name: 'projectId' })
  @ApiOperation({ summary: 'Create a programme delivery milestone (PLANNED)' })
  create(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
    @Body() dto: CreateMilestoneDto,
  ) {
    return this.service.createMilestone(identity, projectId, dto);
  }

  @Get('projects/:projectId/programme/milestones')
  @ApiParam({ name: 'projectId' })
  @ApiOperation({ summary: 'List the project programme milestones' })
  list(@CurrentUser() identity: RequestIdentity, @Param('projectId') projectId: string) {
    return this.service.listMilestones(identity, projectId);
  }

  @Post('programme/milestones/:id/verify')
  @RequirePermissions(PERMISSIONS.projectsManage)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Verify a milestone — the stage is complete (records the actual date)' })
  verify(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() dto: VerifyMilestoneDto,
  ) {
    return this.service.verifyMilestone(identity, id, dto);
  }
}
