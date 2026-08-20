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
import {
  CreatePurchaseOrderDto,
  RevisePurchaseOrderDto,
} from './dto/create-purchase-order.dto.js';

@ApiTags('Procurement — Purchase Orders')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.procurementView)
@Controller('procurement/purchase-orders')
export class PurchaseOrderController {
  constructor(private readonly service: PurchaseOrderService) {}

  @Get()
  @ApiOperation({ summary: 'List purchase orders' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'supplierId', required: false })
  findAll(
    @CurrentUser() identity: RequestIdentity,
    @Query('status', new ParseEnumPipe(PurchaseOrderStatus, { optional: true }))
    status?: PurchaseOrderStatus,
    @Query('supplierId') supplierId?: string,
  ) {
    return this.service.findAll(identity, { status, supplierId });
  }

  @Post()
  @RequirePermissions(PERMISSIONS.purchaseOrdersCreate)
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
  @RequirePermissions(PERMISSIONS.purchaseOrdersCreate)
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Submit PO revision for approval: DRAFT → SUBMITTED' })
  submit(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.service.submit(identity, id);
  }

  @Post(':id/approve')
  @RequirePermissions(PERMISSIONS.purchaseOrdersApprove)
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Approve PO revision: SUBMITTED → ACTIVE. Writes CommitmentLedger COMMITTED entries.',
  })
  approve(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.service.approve(identity, id);
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
}
