import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type OutboundMessageView, type RequestIdentity } from '@erp/types';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator.js';
import { CommunicationService } from '../communication.service.js';
import { CommunicationsQueryDto } from './dto/communications-query.dto.js';
import { ResolveMessageDto } from './dto/resolve-message.dto.js';

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
  list(
    @CurrentUser() identity: RequestIdentity,
    @Query() query: CommunicationsQueryDto,
  ): Promise<OutboundMessageView[]> {
    return this.communication.listForResource(identity, query.resourceType, query.resourceId);
  }

  @Post(':id/resolve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark a message WhatsApp never confirmed (UNKNOWN) as sent or not sent',
  })
  resolve(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() dto: ResolveMessageDto,
  ): Promise<OutboundMessageView> {
    return this.communication.resolveUnknown(identity, id, {
      outcome: dto.outcome,
      note: dto.note,
    });
  }
}
