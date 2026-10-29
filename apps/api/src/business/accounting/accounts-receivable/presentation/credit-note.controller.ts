import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import { CreditNoteService } from '../application/credit-note.service.js';
import { RaiseCreditNoteDto, ReverseCreditNoteRequestDto } from './dto/credit-note.dto.js';

/**
 * AR-1 — credit notes from Finance, for any posted invoice: a hand-typed sale has no project, so
 * the project route (`/projects/:id/commercial/invoices/:id/credit-notes`) could never reach it.
 * Same service, same rules (never above the outstanding balance, posted with a CN- number,
 * reversed by a mirror journal).
 */
@ApiTags('Client Invoices')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.receivablesManage)
@Controller('invoices/:invoiceId/credit-notes')
export class CreditNoteController {
  constructor(private readonly creditNotes: CreditNoteService) {}

  @Get()
  @ApiOperation({ summary: 'AR-1: the credit notes raised against an invoice, oldest first' })
  list(@CurrentUser() identity: RequestIdentity, @Param('invoiceId') invoiceId: string) {
    return this.creditNotes.listForInvoice(identity, invoiceId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'AR-1: raise a credit note (draft) against a posted invoice' })
  @ApiResponse({ status: 400, description: 'Invoice not posted, or the credit would exceed the outstanding balance' })
  raise(@CurrentUser() identity: RequestIdentity, @Param('invoiceId') invoiceId: string, @Body() dto: RaiseCreditNoteDto) {
    return this.creditNotes.createCreditNote(identity, { invoiceId, ...dto });
  }

  @Post(':creditNoteId/post')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'AR-1: post a credit note — reduces the invoice balance (EVT-AR-007)' })
  post(
    @CurrentUser() identity: RequestIdentity,
    @Param('invoiceId') invoiceId: string,
    @Param('creditNoteId') creditNoteId: string,
  ) {
    return this.creditNotes.postCreditNote(identity, { creditNoteId, invoiceId });
  }

  @Post(':creditNoteId/reverse')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'AR-1: reverse a posted credit note (EVT-AR-008) and restore the invoice balance' })
  reverse(
    @CurrentUser() identity: RequestIdentity,
    @Param('invoiceId') invoiceId: string,
    @Param('creditNoteId') creditNoteId: string,
    @Body() dto: ReverseCreditNoteRequestDto,
  ) {
    return this.creditNotes.reverseCreditNote(identity, { creditNoteId, invoiceId, ...dto });
  }
}
