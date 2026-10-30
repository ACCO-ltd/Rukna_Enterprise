import {
  Body,
  Controller,
  ForbiddenException,
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
import { RequireAnyPermission } from '../../../common/decorators/require-permissions.decorator.js';
import { CommunicationService } from '../communication.service.js';
import { CommunicationsQueryDto } from './dto/communications-query.dto.js';
import { ResolveMessageDto } from './dto/resolve-message.dto.js';

/**
 * ADR-042 phase 2 — messages Rukna sent about a record (invoice, receipt, statement). Client
 * records need `manage:receivable`; the supplier statement (SS-3) needs `manage:payable`. Those
 * callers see the full recipient number.
 */
@ApiTags('Communications')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequireAnyPermission(PERMISSIONS.receivablesManage, PERMISSIONS.payablesManage)
@Controller('communications')
export class CommunicationsController {
  constructor(private readonly communication: CommunicationService) {}

  @Get()
  @ApiOperation({ summary: 'Outbound messages for one record, newest first' })
  list(
    @CurrentUser() identity: RequestIdentity,
    @Query() query: CommunicationsQueryDto,
  ): Promise<OutboundMessageView[]> {
    const needs = query.resourceType === 'supplier_statement' ? PERMISSIONS.payablesManage : PERMISSIONS.receivablesManage;
    if (!identity.permissions.includes('*') && !identity.permissions.includes(needs)) {
      throw new ForbiddenException({ errorCode: 'FORBIDDEN', message: 'You cannot see the messages about this record.' });
    }
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
