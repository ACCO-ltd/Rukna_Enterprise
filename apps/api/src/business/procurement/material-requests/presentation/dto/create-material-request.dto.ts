import {
  IsString, IsEnum, IsOptional, IsArray, ValidateNested,
  IsPositive, IsDateString, ArrayMinSize, IsNumber, MaxLength, Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateMrLineDto {
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
  requestedQuantity: number;

  @ApiPropertyOptional()
  /**
   * The requester's estimate of unit cost. ADR-022 CONST-DOA-001 routes approval by **monetary
   * threshold**, so a requirement with no value cannot be routed at all — this is the field that
   * makes the approval chain reachable. It is superseded by the PO line's real `unitPrice` the
   * moment a buyer has been to market; the two are never netted into a "saving".
   */
  @ApiPropertyOptional({ example: 100, description: "Requester's estimate of unit cost" })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  estimatedUnitPrice?: number;

  @IsOptional()
  @IsString()
  boqNodeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  spendCategoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  departmentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  costCenterId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  projectCostCategoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateMaterialRequestDto {
  @ApiProperty({ enum: ['PROJECT', 'ORGANIZATION'] })
  @IsEnum(['PROJECT', 'ORGANIZATION'])
  requestScope: 'PROJECT' | 'ORGANIZATION';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  projectId?: string;

  @ApiProperty({ example: '2026-08-07' })
  @IsDateString()
  requestedDate: string;

  @ApiPropertyOptional({ example: '2026-08-21' })
  @IsOptional()
  @IsDateString()
  requiredByDate?: string;

  /** A short name for the requirement, distinct from the paragraph that justifies it. */
  @ApiPropertyOptional({ example: 'Reinforcement steel' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  title?: string;

  /**
   * The currency the line estimates are in. Required whenever any line carries an estimate —
   * an amount without a currency is not a figure anyone can approve against a threshold.
   */
  @ApiPropertyOptional({ example: 'USD' })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currencyCode?: string;

  /** How badly the site needs it. Orders the attention queue; authorises nothing by itself. */
  @ApiPropertyOptional({ enum: ['LOW', 'NORMAL', 'HIGH', 'URGENT'] })
  @IsOptional()
  @IsEnum(['LOW', 'NORMAL', 'HIGH', 'URGENT'])
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({ type: [CreateMrLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateMrLineDto)
  lines: CreateMrLineDto[];
}
