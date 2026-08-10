import {
  IsString, IsEnum, IsOptional, IsArray, ValidateNested,
  IsPositive, IsDateString, ArrayMinSize, IsNumber, Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateGrnLineDto {
  @ApiProperty()
  @IsString()
  purchaseOrderLineId: string;

  @ApiProperty({ example: 25 })
  @IsPositive()
  receivedQuantity: number;

  @ApiProperty({ example: 24 })
  @IsNumber()
  @Min(0)
  acceptedQuantity: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Min(0)
  rejectedQuantity?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  rejectionReason?: string;

  @ApiProperty({ enum: ['PENDING_INSPECTION', 'ACCEPTED', 'PARTIALLY_ACCEPTED', 'REJECTED'] })
  @IsEnum(['PENDING_INSPECTION', 'ACCEPTED', 'PARTIALLY_ACCEPTED', 'REJECTED'])
  qualityStatus: 'PENDING_INSPECTION' | 'ACCEPTED' | 'PARTIALLY_ACCEPTED' | 'REJECTED';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateGoodsReceiptDto {
  @ApiProperty()
  @IsString()
  purchaseOrderId: string;

  @ApiProperty({ example: '2026-08-10' })
  @IsDateString()
  deliveryDate: string;

  @ApiPropertyOptional({ example: 'DN-2024-0042' })
  @IsOptional()
  @IsString()
  deliveryNoteRef?: string;

  @ApiProperty({ type: [CreateGrnLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateGrnLineDto)
  lines: CreateGrnLineDto[];
}

export class PostGoodsReceiptDto {
  @ApiProperty({ example: 1.0 })
  @IsNumber()
  @IsPositive()
  exchangeRate: number;

  @ApiProperty({ example: 'SAR' })
  @IsString()
  reportingCurrencyCode: string;
}
