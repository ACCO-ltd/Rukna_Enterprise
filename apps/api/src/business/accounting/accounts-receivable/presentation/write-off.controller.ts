import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import { WriteOffService } from '../application/write-off.service.js';
import { RejectWriteOffDto, RequestWriteOffDto, ReverseCreditNoteRequestDto } from './dto/credit-note.dto.js';

/** AR-4 — write-offs: requested on an invoice, decided (above the limit) and reversed by id. */
@ApiTags('Client Invoices')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.receivablesManage)
@Controller()
export class WriteOffController {
  constructor(private readonly writeOffs: WriteOffService) {}

  @Get('invoices/:invoiceId/write-offs')
  @ApiOperation({ summary: 'AR-4: the write-offs on an invoice, oldest first' })
  list(@CurrentUser() identity: RequestIdentity, @Param('invoiceId') invoiceId: string) {
    return this.writeOffs.listForInvoice(identity, invoiceId);
  }

  @Post('invoices/:invoiceId/write-offs')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'AR-4: write off part of an open balance — posts at once up to the limit, else waits for approval' })
  request(@CurrentUser() identity: RequestIdentity, @Param('invoiceId') invoiceId: string, @Body() dto: RequestWriteOffDto) {
    return this.writeOffs.request(identity, { invoiceId, ...dto });
  }

  @Post('receivable-write-offs/:id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'AR-4: approve a write-off above the limit (not the requester); it posts' })
  approve(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.writeOffs.approve(identity, id);
  }

  @Post('receivable-write-offs/:id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'AR-4: reject a write-off waiting for approval' })
  reject(@CurrentUser() identity: RequestIdentity, @Param('id') id: string, @Body() dto: RejectWriteOffDto) {
    return this.writeOffs.reject(identity, id, dto.reason);
  }

  @Post('receivable-write-offs/:id/reverse')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'AR-4: reverse a posted write-off; the invoice balance comes back' })
  reverse(@CurrentUser() identity: RequestIdentity, @Param('id') id: string, @Body() dto: ReverseCreditNoteRequestDto) {
    return this.writeOffs.reverse(identity, id, dto);
  }
}
