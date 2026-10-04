import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  ParseEnumPipe,
  UseGuards,
} from '@nestjs/common';
import { PurchaseOrderStatus } from '@prisma/client';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';
import { PurchaseOrderService } from '../application/purchase-order.service.js';
import { SettlementQueryService } from '../application/settlement-query.service.js';
import { ReceivabilityService } from '../application/receivability.service.js';
import {
  CreatePurchaseOrderDto,
  RevisePurchaseOrderDto,
} from './dto/create-purchase-order.dto.js';
import { AttachPoRevisionFileDto } from './dto/attach-po-revision-file.dto.js';

@ApiTags('Procurement — Purchase Orders')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.procurementView)
@Controller('procurement/purchase-orders')
export class PurchaseOrderController {
  constructor(
    private readonly service: PurchaseOrderService,
    private readonly settlementQuery: SettlementQueryService,
    private readonly receivability: ReceivabilityService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List purchase orders' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'supplierId', required: false })
  @ApiQuery({ name: 'projectId', required: false })
  findAll(
    @CurrentUser() identity: RequestIdentity,
    @Query('status', new ParseEnumPipe(PurchaseOrderStatus, { optional: true }))
    status?: PurchaseOrderStatus,
    @Query('supplierId') supplierId?: string,
    @Query('projectId') projectId?: string,
  ) {
    return this.service.findAll(identity, { status, supplierId, projectId });
  }

  @Post()
  @RequirePermissions(PERMISSIONS.purchaseOrdersCreate)
  @ApiOperation({ summary: 'Create a purchase order (DRAFT)' })
  create(@CurrentUser() identity: RequestIdentity, @Body() dto: CreatePurchaseOrderDto) {
    return this.service.create(identity, dto);
  }

  // Declared before ':id' so the literal segment is not captured as an id.
  @Get('receivable')
  @RequirePermissions(PERMISSIONS.procurementView, PERMISSIONS.goodsReceiptsCreate)
  @ApiOperation({
    summary:
      'OPEN POs with quantity left to receive, each with canReceive / blockedReason / receiptException for the caller (no prices)',
  })
  listReceivable(@CurrentUser() identity: RequestIdentity) {
    return this.receivability.listReceivable(identity);
  }

  @Get(':id')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Get purchase order with all revisions' })
  findById(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.service.findById(identity, id);
  }

  @Post(':id/confirm')
  @RequirePermissions(PERMISSIONS.purchaseOrdersCreate)
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Confirm PO: DRAFT revision → ACTIVE, PO DRAFT → OPEN. Writes COMMITTED ledger entries.',
  })
  confirm(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.service.confirm(identity, id);
  }

  @Get(':id/settlement')
  // ADR-043 review M2: the settlement read carries money (bill totals, settled, outstanding,
  // advances), so it needs cost visibility as well as procurement access — the same gate as
  // `bill-payments` — and project access to every project the PO is coded to.
  @RequirePermissions(PERMISSIONS.procurementView, PERMISSIONS.commitmentsView)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Settlement read model: funding, receiving, and reconciliation status' })
  getSettlement(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.settlementQuery.getSettlementForViewer(identity, id);
  }

  @Get(':id/receiving')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Receiving only: ordered vs accepted quantity per line (no money)' })
  getReceiving(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.settlementQuery.getReceiving(identity, id);
  }

  @Get(':id/bill-payments')
  // Method-level permissions override the class gate, so both are listed: procurement access AND
  // cost visibility (ADR-043 decision 4 — Procurement Manager yes, Project Manager / Site Engineer no).
  @RequirePermissions(PERMISSIONS.procurementView, PERMISSIONS.commitmentsView)
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: "Payment status of the PO's supplier bills: total, paid, in progress, outstanding, last payment date",
  })
  getBillPayments(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.settlementQuery.getBillPayments(identity, id);
  }

  @Post(':id/revise')
  @RequirePermissions(PERMISSIONS.purchaseOrdersCreate)
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Create a new DRAFT revision for an OPEN PO' })
  revise(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() dto: RevisePurchaseOrderDto,
  ) {
    return this.service.revise(identity, id, dto);
  }

  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.purchaseOrdersCreate)
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Cancel purchase order' })
  cancel(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.service.cancel(identity, id);
  }

  @Get(':id/revision-attachments')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'List attachments on the current DRAFT or ACTIVE revision' })
  listRevisionAttachments(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.service.listRevisionAttachments(identity, id);
  }

  @Post(':id/revision-attachments')
  @RequirePermissions(PERMISSIONS.purchaseOrdersCreate)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Attach a file to the current DRAFT revision (throws if no DRAFT exists)' })
  attachToRevision(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() dto: AttachPoRevisionFileDto,
  ) {
    return this.service.attachToRevision(identity, id, dto);
  }
}
