import {
  Controller, Get, Post, Body, Param, Query,
  HttpCode, HttpStatus, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import type { RequestIdentity } from '@erp/types';
import { PurchaseOrderService } from '../application/purchase-order.service.js';
import {
  CreatePurchaseOrderDto,
  ApprovePurchaseOrderDto,
  RevisePurchaseOrderDto,
} from './dto/create-purchase-order.dto.js';

@ApiTags('Procurement — Purchase Orders')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('procurement/purchase-orders')
export class PurchaseOrderController {
  constructor(private readonly service: PurchaseOrderService) {}

  @Get()
  @ApiOperation({ summary: 'List purchase orders' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'supplierId', required: false })
  findAll(
    @CurrentUser() identity: RequestIdentity,
    @Query('status') status?: string,
    @Query('supplierId') supplierId?: string,
  ) {
    return this.service.findAll(identity, { status: status as any, supplierId });
  }

  @Post()
  @ApiOperation({ summary: 'Create a purchase order (DRAFT revision)' })
  create(@CurrentUser() identity: RequestIdentity, @Body() dto: CreatePurchaseOrderDto) {
    return this.service.create(identity, dto);
  }

  @Get(':id')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Get purchase order with all revisions' })
  findById(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.service.findById(identity, id);
  }

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Submit PO revision for approval: DRAFT → SUBMITTED' })
  submit(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.service.submit(identity, id);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Approve PO revision: SUBMITTED → ACTIVE. Writes CommitmentLedger COMMITTED entries.' })
  approve(@CurrentUser() identity: RequestIdentity, @Param('id') id: string, @Body() dto: ApprovePurchaseOrderDto) {
    return this.service.approve(identity, id, dto);
  }

  @Post(':id/revise')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Create a new DRAFT revision for an OPEN PO' })
  revise(@CurrentUser() identity: RequestIdentity, @Param('id') id: string, @Body() dto: RevisePurchaseOrderDto) {
    return this.service.revise(identity, id, dto);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Cancel purchase order' })
  cancel(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.service.cancel(identity, id);
  }
}
