import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import { SupplierDebitNoteService } from '../application/supplier-debit-note.service.js';
import { RecordDebitNoteDto, ReverseDebitNoteDto } from './dto/supplier-debit-note.dto.js';

@ApiTags('Supplier Bills')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.payablesManage)
@Controller()
export class SupplierDebitNoteController {
  constructor(private readonly debitNotes: SupplierDebitNoteService) {}

  @Get('bills/:billId/debit-notes')
  @ApiOperation({ summary: 'AP-4: the debit notes recorded against a bill' })
  list(@CurrentUser() identity: RequestIdentity, @Param('billId') billId: string) {
    return this.debitNotes.listForBill(identity, billId);
  }

  @Post('bills/:billId/debit-notes')
  @ApiOperation({ summary: 'AP-4: record a credit from the supplier against a posted bill (posts at once: Dr AP / Cr the bill’s cost lines)' })
  @ApiResponse({ status: 400, description: 'DEBIT_NOTE_AMOUNT_INVALID · DEBIT_NOTE_DATE_INVALID · REASON_REQUIRED · BILL_NOT_POSTED · DEBIT_NOTE_EXCEEDS_BALANCE' })
  record(@CurrentUser() identity: RequestIdentity, @Param('billId') billId: string, @Body() dto: RecordDebitNoteDto) {
    return this.debitNotes.record(identity, { billId, ...dto });
  }

  @Post('supplier-debit-notes/:id/reverse')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'AP-4: reverse a debit note recorded in error (the bill balance comes back)' })
  @ApiResponse({ status: 409, description: 'DEBIT_NOTE_NOT_POSTED' })
  reverse(@CurrentUser() identity: RequestIdentity, @Param('id') id: string, @Body() dto: ReverseDebitNoteDto) {
    return this.debitNotes.reverse(identity, id, dto);
  }
}
