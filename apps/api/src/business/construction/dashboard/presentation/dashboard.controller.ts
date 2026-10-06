import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { DashboardResponse, RequestIdentity } from '@erp/types';

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';

import { DashboardService } from '../application/dashboard.service.js';

/**
 * The Dashboard (design-system P30–P32). Every authenticated user has one, so there is no
 * `@RequirePermissions`: each part is gated inside the read model — money on the portfolio's rule
 * (`view-margin:boq` tier + `view:financial-position`), each to-do on the permission that does the
 * work, projects on the project-access rule.
 */
@ApiTags('Dashboard')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get()
  @ApiOperation({
    summary: "The caller's dashboard (read-only)",
    description:
      'Company stage (NEW / PREPARATION / RUNNING), the To-do list in urgency order, headline money ' +
      'per currency (receivables with aging, payables), started and Preparation projects, the five ' +
      'latest activity events, and — for a new company — the setup checklist. Scoped to the ' +
      "caller's projects and permissions; hidden money is null.",
  })
  get(@CurrentUser() identity: RequestIdentity): Promise<DashboardResponse> {
    return this.service.get(identity);
  }
}
