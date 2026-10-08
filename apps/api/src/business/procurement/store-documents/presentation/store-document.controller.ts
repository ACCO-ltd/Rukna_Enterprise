import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsDateString, IsIn, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import { StoreDocumentService } from '../application/store-document.service.js';

const SOURCES = ['CAMERA', 'GALLERY', 'UNKNOWN'] as const;

export class StoreDocumentPhotoDto {
  @ApiProperty() @IsString() platformFileId!: string;
  @ApiProperty({ example: '2026-10-08T07:31:00.000Z' }) @IsDateString() capturedAt!: string;
  @ApiProperty({ enum: SOURCES }) @IsIn(SOURCES) source!: (typeof SOURCES)[number];
}

export class CreateStoreDocumentDto {
  @ApiProperty({ description: 'uuid from the phone upload queue (idempotency)' }) @IsUUID() clientRef!: string;
  @ApiProperty() @IsString() purchaseOrderId!: string;
  @ApiProperty({ enum: ['RECEIPT', 'INVOICE'] }) @IsIn(['RECEIPT', 'INVOICE']) kind!: 'RECEIPT' | 'INVOICE';
  @ApiProperty({ type: [StoreDocumentPhotoDto] })
  @ValidateNested({ each: true })
  @Type(() => StoreDocumentPhotoDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  photos!: StoreDocumentPhotoDto[];
}

const REJECT_REASONS = ['ILLEGIBLE', 'WRONG_PO', 'DUPLICATE', 'OTHER'] as const;

export class RejectStoreDocumentDto {
  @ApiProperty({ enum: REJECT_REASONS }) @IsIn(REJECT_REASONS) reason!: (typeof REJECT_REASONS)[number];
  @ApiPropertyOptional({ maxLength: 500 }) @IsOptional() @IsString() @MaxLength(500) note?: string;
}

/**
 * ADR-045 §2 — store receipts / invoices photographed by the buyer. Capture is procurement
 * (`view:procurement` + `collect:quotation`); reject is finance (`manage:payable`). Recording into a
 * bill is `POST /supplier-bills/from-store-document` (Accounts Payable).
 */
@ApiTags('Store Documents')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.procurementView)
@Controller('procurement/store-documents')
export class StoreDocumentController {
  constructor(private readonly service: StoreDocumentService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.procurementView, PERMISSIONS.quotationsCollect)
  @ApiOperation({ summary: 'Send the photographed receipt/invoice of an award order (no amount); idempotent on clientRef' })
  create(@CurrentUser() identity: RequestIdentity, @Body() dto: CreateStoreDocumentDto) {
    return this.service.create(identity, dto);
  }

  @Get()
  @ApiQuery({ name: 'purchaseOrderId', required: true })
  @ApiOperation({ summary: 'Store documents of an order; photo ids only for callers who may see them' })
  list(@CurrentUser() identity: RequestIdentity, @Query('purchaseOrderId') purchaseOrderId: string) {
    return this.service.list(identity, purchaseOrderId);
  }

  @Post(':id/photos')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.procurementView, PERMISSIONS.quotationsCollect)
  @ApiOperation({ summary: 'Add a page while the document waits (uploader only)' })
  addPhoto(@CurrentUser() identity: RequestIdentity, @Param('id') id: string, @Body() dto: StoreDocumentPhotoDto) {
    return this.service.addPhoto(identity, id, dto);
  }

  @Post(':id/withdraw')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.procurementView, PERMISSIONS.quotationsCollect)
  @ApiOperation({ summary: 'Withdraw a waiting document (uploader only)' })
  withdraw(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.service.withdraw(identity, id);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.payablesManage)
  @ApiOperation({ summary: 'Finance refuses the document; the buyer is told in-app' })
  reject(@CurrentUser() identity: RequestIdentity, @Param('id') id: string, @Body() dto: RejectStoreDocumentDto) {
    return this.service.reject(identity, id, dto.reason, dto.note);
  }
}
