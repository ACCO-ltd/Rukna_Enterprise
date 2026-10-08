import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiTags } from '@nestjs/swagger';
import { IsDateString, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import { AwardSupplierPaymentService } from '../application/award-supplier-payment.service.js';
import { StoreDocumentSettlementService } from '../application/store-document-settlement.service.js';
import { PayFromAwardDto } from './dto/award-payment.dto.js';

export class RecordStoreDocumentDto {
  @ApiProperty() @IsString() @IsNotEmpty() storeDocumentId!: string;

  @ApiPropertyOptional({ example: '980.00', description: 'Required on the first call (creates the bill); ignored on resume' })
  @IsOptional() @Matches(/^\d+(\.\d{1,2})?$/, { message: 'total must be a positive amount with at most 2 decimals' })
  total?: string;

  @ApiPropertyOptional({ example: '2026-10-08', description: 'The receipt date finance confirms (the bill date)' })
  @IsOptional() @IsDateString()
  documentDate?: string;

  @ApiPropertyOptional({ maxLength: 60, description: 'The printed receipt number; default SD-number' })
  @IsOptional() @IsString() @MaxLength(60)
  supplierInvoiceNumber?: string;

  @ApiPropertyOptional({ example: 'COST_51100' })
  @IsOptional() @IsString() @MaxLength(50)
  expenseProfileCode?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional() @IsString() @MaxLength(500)
  note?: string;
}

/**
 * ADR-045 — the Accounts Payable commands started from a quotation award (`manage:payable`):
 * paying the supplier (FINANCE_PAYS_SUPPLIER) and recording the store document into the bill.
 * (The existing payment / bill routes stay at `/payments` and `/bills`.)
 */
@ApiTags('Paying from the award')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.payablesManage)
@Controller()
export class AwardPaymentController {
  constructor(
    private readonly awardPayments: AwardSupplierPaymentService,
    private readonly settlement: StoreDocumentSettlementService,
  ) {}

  @Get('supplier-payments/award-draft')
  @ApiQuery({ name: 'quotationRequestId', required: true })
  @ApiOperation({ summary: 'Prefill for "Pay supplier" from an award: supplier, shape, bills, accounts, blockers' })
  awardDraft(@CurrentUser() identity: RequestIdentity, @Query('quotationRequestId') quotationRequestId: string) {
    return this.awardPayments.awardDraft(identity, quotationRequestId);
  }

  @Post('supplier-payments/from-award')
  @ApiOperation({
    summary:
      'Pay the awarded supplier: PREPAY (supplier advance + purchase allocation) or PAY_BILL; create → approve → post. ' +
      'Idempotent on idempotencyKey; 409 { approvalInstanceId } while gated; { awaiting: RELEASE_SIGNATURES } under dual control.',
  })
  payFromAward(@CurrentUser() identity: RequestIdentity, @Body() dto: PayFromAwardDto) {
    return this.awardPayments.payFromAward(identity, dto);
  }

  @Post('supplier-payments/:id/continue')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary:
      'Finish a payment made from an award from whatever state it is in (approve → release → post), with no client-held ' +
      'body — the target of payment.pending[].continue for SUPPLIER_PAYMENT. Same response shape as from-award.',
  })
  continuePayment(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.awardPayments.continuePayment(identity, id);
  }

  @Post('supplier-bills/from-store-document')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Record a store receipt/invoice: create the PO bill, submit (match), approve, post, then settle it from the buyer cash ' +
      '(EVT-AP-008) or the prepayment (EVT-AP-005). Resumable: re-tap with { storeDocumentId }.',
  })
  record(@CurrentUser() identity: RequestIdentity, @Body() dto: RecordStoreDocumentDto) {
    return this.settlement.record(identity, dto);
  }
}
