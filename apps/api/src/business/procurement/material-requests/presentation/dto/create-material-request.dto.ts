import {
  IsString, IsEnum, IsOptional, IsArray, ValidateNested,
  IsPositive, IsDateString, ArrayMinSize,
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

  @ApiPropertyOptional()
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
