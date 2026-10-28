import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { RequestIdentity } from '@erp/types';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import { ApprovalsInboxService } from '../application/approvals-inbox.service.js';

/**
 * Step 3 (ADR-049) — the Approvals inbox. Authentication only at the route: each queue is gated in
 * the service on the permission its own Approve / Decide endpoint requires.
 */
@ApiTags('Approvals')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('approvals')
export class ApprovalsInboxController {
  constructor(private readonly service: ApprovalsInboxService) {}

  @Get('inbox')
  @ApiOperation({ summary: 'Everything waiting on the caller’s decision, oldest first, with the count' })
  inbox(@CurrentUser() identity: RequestIdentity) {
    return this.service.inbox(identity);
  }
}
