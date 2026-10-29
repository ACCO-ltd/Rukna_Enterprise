import { Body, Controller, Delete, Get, HttpCode, Param, ParseEnumPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { RequireAnyPermission } from '../../../../common/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import { FinanceAttachmentService } from '../application/finance-attachment.service.js';
import { FINANCE_ATTACHMENT_KINDS, type FinanceAttachmentKind } from '../../../../platform/files/domain/finance-attachment-policy.js';

export class AttachFinanceFileDto {
  @IsString()
  @MinLength(1)
  platformFileId!: string;
}

const KIND_PIPE = new ParseEnumPipe(Object.fromEntries(FINANCE_ATTACHMENT_KINDS.map((k) => [k, k])));

/**
 * Step 4 — attachments on invoices, receipts, bills, payments and journals. The route gate admits
 * anyone who works in finance; the service then applies the per-document rule (attachment-policy).
 */
@ApiTags('Accounting')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequireAnyPermission(
  PERMISSIONS.accountingView,
  PERMISSIONS.receivablesManage,
  PERMISSIONS.payablesManage,
  PERMISSIONS.journalsManage,
)
@Controller('finance/attachments/:kind/:ownerId')
export class FinanceAttachmentController {
  constructor(private readonly service: FinanceAttachmentService) {}

  @Get()
  @ApiOperation({ summary: 'List the files attached to a finance document' })
  list(
    @CurrentUser() identity: RequestIdentity,
    @Param('kind', KIND_PIPE) kind: FinanceAttachmentKind,
    @Param('ownerId') ownerId: string,
  ) {
    return this.service.list(identity, kind, ownerId);
  }

  @Post()
  @ApiOperation({ summary: 'Attach an uploaded file; on a posted document it is kept for good' })
  attach(
    @CurrentUser() identity: RequestIdentity,
    @Param('kind', KIND_PIPE) kind: FinanceAttachmentKind,
    @Param('ownerId') ownerId: string,
    @Body() dto: AttachFinanceFileDto,
  ) {
    return this.service.attach(identity, kind, ownerId, dto.platformFileId);
  }

  @Delete(':attachmentId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Remove a file from a document that has not posted' })
  remove(
    @CurrentUser() identity: RequestIdentity,
    @Param('kind', KIND_PIPE) kind: FinanceAttachmentKind,
    @Param('ownerId') ownerId: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    return this.service.remove(identity, kind, ownerId, attachmentId);
  }
}
