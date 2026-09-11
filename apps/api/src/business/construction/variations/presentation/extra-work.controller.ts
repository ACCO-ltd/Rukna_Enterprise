import { Controller, Post, Body, Param, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiResponse } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { ProjectScoped } from '../../../../common/decorators/project-scoped.decorator.js';
import { ProjectAccessGuard } from '../../../../platform/project-access/project-access.guard.js';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { ExtraWorkClassifierService } from '../application/extra-work-classifier.service.js';
import { AddExtraWorkDto } from './dto/add-extra-work.dto.js';

/**
 * ADR-029 R5 — the extra-work classifier endpoint (spec E-1..E-4).
 *
 * Sits under the project/BOQ namespace so the frontend calls one route, but the handler lives in
 * VariationsModule (VariationsModule → BoqModule already exists; BOQ must not depend on Variations —
 * a cycle). The route-level guard is only the BOQ read surface (`view:boq`) + project membership; the
 * per-treatment permission (`manage-contingency:boq` for ABSORB, `manage:boq` for SEPARATE,
 * `contractsManage` for VARIATION) is enforced in the service, because @RequirePermissions is
 * AND-semantics and cannot vary by request body.
 */
@ApiTags('BOQ')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, ProjectAccessGuard)
@RequirePermissions(PERMISSIONS.boqView)
@ProjectScoped()
@Controller('projects/:projectId/boq')
export class ExtraWorkController {
  constructor(private readonly classifier: ExtraWorkClassifierService) {}

  @Post('extra-work')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Classify post-commit extra work: ABSORB (contingency-funded), VARIATION (client-paid, DRAFT VO), or SEPARATE (one-off charge). Adds ABSORBED/SEPARATE_CHARGE BOQ leaves or creates a DRAFT VariationOrder.',
  })
  @ApiParam({ name: 'projectId' })
  @ApiResponse({ status: 200, description: 'Scope classified — nodes added (ABSORB/SEPARATE) or a DRAFT VO created (VARIATION)' })
  @ApiResponse({ status: 400, description: 'Over-draw (CONTINGENCY_EXCEEDED), missing contractId for VARIATION, or invalid line' })
  @ApiResponse({ status: 403, description: 'Missing the per-treatment permission' })
  @ApiResponse({ status: 409, description: 'Committed pin (CONTRACT_VALUE_LOCKED) — should not fire for a net-zero absorb' })
  addExtraWork(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
    @Body() dto: AddExtraWorkDto,
  ) {
    return this.classifier.addExtraWork(identity, projectId, dto);
  }
}
