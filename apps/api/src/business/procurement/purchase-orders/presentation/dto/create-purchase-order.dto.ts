import {
  IsString, IsEnum, IsOptional, IsArray, ValidateNested,
  IsPositive, IsDateString, ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MrLineAllocationDto {
  @ApiProperty()
  @IsString()
  materialRequestLineId: string;

  @ApiProperty({ example: 10 })
  @IsPositive()
  allocatedQuantity: number;
}

export class CreatePoLineDto {
  @ApiProperty({ enum: ['MATERIAL', 'SERVICE', 'OTHER'] })
  @IsEnum(['MATERIAL', 'SERVICE', 'OTHER'])
  lineType: 'MATERIAL' | 'SERVICE' | 'OTHER';

  @ApiPropertyOptional({ example: 'REBAR-12MM' })
  @IsOptional()
  @IsString()
  materialCode?: string;

  @ApiProperty({ example: '12mm deformed rebar' })
  @IsString()
  description: string;

  @ApiProperty({ example: 'TON' })
  @IsString()
  uomCode: string;

  @ApiProperty({ example: 25 })
  @IsPositive()
  orderedQuantity: number;

  @ApiProperty({ example: 850 })
  @IsPositive()
  unitPrice: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  spendCategoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  taxCodeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ type: [MrLineAllocationDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MrLineAllocationDto)
  mrLineAllocations?: MrLineAllocationDto[];
}

export class CreatePurchaseOrderDto {
  @ApiProperty()
  @IsString()
  supplierId: string;

  @ApiProperty({ example: 'SAR' })
  @IsString()
  currencyCode: string;

  @ApiProperty({ example: '2026-08-07' })
  @IsDateString()
  effectiveFrom: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  deliveryAddress?: string;

  @ApiPropertyOptional({ example: '2026-09-01' })
  @IsOptional()
  @IsDateString()
  expectedDeliveryDate?: string;

  @ApiProperty({ type: [CreatePoLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreatePoLineDto)
  lines: CreatePoLineDto[];
}

export class RevisePurchaseOrderDto extends CreatePurchaseOrderDto {
  @ApiProperty({ description: 'Reason for revision' })
  @IsString()
  declare reason: string;
}
