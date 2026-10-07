import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
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
import { QuotationSelectionService } from '../application/quotation-selection.service.js';
import { QuotationAwardService } from '../application/quotation-award.service.js';
import { QuotationOrderService } from '../application/quotation-order.service.js';
import { QuotationListService } from '../application/quotation-list.service.js';
import {
  AddQuoteDto,
  ListQuotationRequestsQuery,
  RaiseOrderDto,
  AwardQuotationDto,
  AskAnotherQuoteDto,
  EnterQuoteTotalDto,
  RejectQuoteDto,
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
    private readonly selection: QuotationSelectionService,
    private readonly awards: QuotationAwardService,
    private readonly orders: QuotationOrderService,
    private readonly lists: QuotationListService,
  ) {}

  @Get()
  @RequirePermissions(P.procurementView)
  @RequireAnyPermission(P.quotationsCollect, P.quotationsAward)
  @ApiOperation({
    summary: 'Quotation queues → { items, page, limit, total }; money fields null unless visible',
  })
  list(@CurrentUser() identity: RequestIdentity, @Query() query: ListQuotationRequestsQuery) {
    return this.lists.list(identity, query);
  }

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

  @Put(':id/quotes/:quoteId/total')
  @RequirePermissions(P.procurementView, P.quotationsAward)
  @ApiOperation({ summary: "Finance types a quote's total from its photo (overwritable until award)" })
  enterTotal(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Param('quoteId') quoteId: string,
    @Body() dto: EnterQuoteTotalDto,
  ) {
    return this.selection.enterTotal(identity, id, quoteId, dto.total);
  }

  @Post(':id/quotes/:quoteId/reject')
  @RequirePermissions(P.procurementView, P.quotationsAward)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject a quote (illegible, wrong items, …); it leaves the comparison' })
  rejectQuote(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Param('quoteId') quoteId: string,
    @Body() dto: RejectQuoteDto,
  ) {
    return this.selection.rejectQuote(identity, id, quoteId, dto.reason, dto.note);
  }

  @Post(':id/ask-another')
  @RequirePermissions(P.procurementView, P.quotationsAward)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ask the collector for another quote: AWAITING_DECISION → RETURNED' })
  askAnother(@CurrentUser() identity: RequestIdentity, @Param('id') id: string, @Body() dto: AskAnotherQuoteDto) {
    return this.selection.askAnother(identity, id, dto.note);
  }

  @Post(':id/award')
  @RequirePermissions(P.procurementView, P.quotationsAward)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Award (= the PO approval). 200 AWARDED, or 409 { details.approvalInstanceId } when the DoA band gates; re-drive with the same body or {}',
  })
  award(@CurrentUser() identity: RequestIdentity, @Param('id') id: string, @Body() dto: AwardQuotationDto) {
    return this.awards.award(identity, id, dto);
  }

  @Post(':id/withdraw-award')
  @RequirePermissions(P.procurementView, P.quotationsAward)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Withdraw a pending award: AWARD_PENDING_APPROVAL → AWAITING_DECISION (instance voided)' })
  withdrawAward(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.awards.withdrawAward(identity, id);
  }

  @Post(':id/request-redecision')
  @RequirePermissions(P.procurementView)
  @RequireAnyPermission(P.quotationsCollect, P.quotationsAward)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Send an award back to finance: AWARDED → AWAITING_DECISION (no order from it was ever issued)',
  })
  requestRedecision(@CurrentUser() identity: RequestIdentity, @Param('id') id: string, @Body() dto: QuotationReasonDto) {
    return this.orders.requestRedecision(identity, id, dto.reason);
  }

  @Get(':id/order-draft')
  @RequirePermissions(P.procurementView, P.quotationsCollect, P.purchaseOrdersCreate)
  @ApiOperation({ summary: 'Preview the purchase order "Raise the order" would create (split mode, lines, prices)' })
  orderDraft(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.orders.orderDraft(identity, id);
  }

  @Post(':id/raise-order')
  @RequirePermissions(P.procurementView, P.quotationsCollect, P.purchaseOrdersCreate)
  @ApiOperation({ summary: 'Raise the DRAFT purchase order from the award → { purchaseOrderId }' })
  raiseOrder(@CurrentUser() identity: RequestIdentity, @Param('id') id: string, @Body() dto: RaiseOrderDto) {
    return this.orders.raiseOrder(identity, id, dto);
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
