import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import {
  RequireAnyPermission,
  RequirePermissions,
} from '../../../../common/decorators/require-permissions.decorator.js';
import { QuotationCollectService } from '../application/quotation-collect.service.js';
import { QuotationQueryService } from '../application/quotation-query.service.js';
import {
  AddQuoteDto,
  OpenQuotationRequestDto,
  QuotationReasonDto,
  QuotePhotoDto,
  SendQuotationDto,
} from './dto/quotation.dto.js';

const P = PERMISSIONS;

/**
 * ADR-044 §12 — competitive quotations. Class-gated on view:procurement; a method's permission list
 * REPLACES the class list (PermissionsGuard getAllAndOverride), so every method restates it.
 * Commands return the request detail read model.
 */
@ApiTags('Procurement — Quotations')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(P.procurementView)
@Controller('procurement/quotation-requests')
export class QuotationRequestController {
  constructor(
    private readonly collect: QuotationCollectService,
    private readonly query: QuotationQueryService,
  ) {}

  @Post()
  @RequirePermissions(P.procurementView, P.quotationsCollect)
  @ApiOperation({
    summary:
      'Open the quotation request for an approved MR (201), or return its live request (200) — never a duplicate',
  })
  async open(
    @CurrentUser() identity: RequestIdentity,
    @Body() dto: OpenQuotationRequestDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { created, request } = await this.collect.open(identity, dto.materialRequestId);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return request;
  }

  @Get(':id')
  @RequirePermissions(P.procurementView)
  @RequireAnyPermission(P.quotationsCollect, P.quotationsAward)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Quotation request detail: quotes, photos, totals (money-gated), allowed actions' })
  detail(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.query.detail(identity, id);
  }

  @Post(':id/quotes')
  @RequirePermissions(P.procurementView, P.quotationsCollect)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Add a store's quote (photos only, no price). Idempotent on clientRef." })
  addQuote(@CurrentUser() identity: RequestIdentity, @Param('id') id: string, @Body() dto: AddQuoteDto) {
    return this.collect.addQuote(identity, id, dto);
  }

  @Post(':id/quotes/:quoteId/photos')
  @RequirePermissions(P.procurementView, P.quotationsCollect)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Add another page to a quote' })
  addPage(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Param('quoteId') quoteId: string,
    @Body() dto: QuotePhotoDto,
  ) {
    return this.collect.addPage(identity, id, quoteId, dto);
  }

  @Post(':id/quotes/:quoteId/withdraw')
  @RequirePermissions(P.procurementView, P.quotationsCollect)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Withdraw a quote while collecting' })
  withdrawQuote(@CurrentUser() identity: RequestIdentity, @Param('id') id: string, @Param('quoteId') quoteId: string) {
    return this.collect.withdrawQuote(identity, id, quoteId);
  }

  @Post(':id/send')
  @RequirePermissions(P.procurementView, P.quotationsCollect)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send to finance: COLLECTING/RETURNED → AWAITING_DECISION; photos become immutable' })
  send(@CurrentUser() identity: RequestIdentity, @Param('id') id: string, @Body() dto: SendQuotationDto) {
    return this.collect.send(identity, id, dto.exceptionReason);
  }

  @Post(':id/reopen')
  @RequirePermissions(P.procurementView, P.quotationsCollect)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reopen a sent request to change evidence: AWAITING_DECISION → COLLECTING' })
  reopen(@CurrentUser() identity: RequestIdentity, @Param('id') id: string, @Body() dto: QuotationReasonDto) {
    return this.collect.reopen(identity, id, dto.reason);
  }

  @Post(':id/cancel')
  @RequirePermissions(P.procurementView)
  @RequireAnyPermission(P.quotationsCollect, P.quotationsAward)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel the request (not once an order raised from its award was issued)' })
  cancel(@CurrentUser() identity: RequestIdentity, @Param('id') id: string, @Body() dto: QuotationReasonDto) {
    return this.collect.cancel(identity, id, dto.reason);
  }
}
