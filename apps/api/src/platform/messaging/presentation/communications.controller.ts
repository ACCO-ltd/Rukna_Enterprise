import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type OutboundMessageView, type RequestIdentity } from '@erp/types';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator.js';
import { CommunicationService } from '../communication.service.js';
import { CommunicationsQueryDto } from './dto/communications-query.dto.js';

/**
 * ADR-042 phase 2 — messages Rukna sent about a record (invoice, receipt …). Gated on
 * `manage:receivable`; those callers see the full recipient number.
 */
@ApiTags('Communications')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.receivablesManage)
@Controller('communications')
export class CommunicationsController {
  constructor(private readonly communication: CommunicationService) {}

  @Get()
  @ApiOperation({ summary: 'Outbound messages for one record, newest first' })
  list(@CurrentUser() identity: RequestIdentity, @Query() query: CommunicationsQueryDto): Promise<OutboundMessageView[]> {
    return this.communication.listForResource(identity, query.resourceType, query.resourceId);
  }
}
