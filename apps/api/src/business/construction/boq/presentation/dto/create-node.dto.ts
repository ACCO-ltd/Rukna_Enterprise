import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsInt,
  Min,
  MaxLength,
  Length,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateNodeDto {
  @ApiPropertyOptional({ description: 'Parent node ID — omit for root-level nodes' })
  @IsOptional()
  @IsString()
  parentId?: string;

  @ApiProperty({ description: 'Sort order among siblings', example: 1 })
  @IsInt()
  @Min(0)
  sortOrder!: number;

  @ApiProperty({ example: '1.2.3', maxLength: 50 })
  @IsString()
  @Length(1, 50)
  code!: string;

  @ApiProperty({ example: 'Reinforced concrete columns' })
  @IsString()
  @MaxLength(500)
  description!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  descriptionAr?: string;

  @ApiPropertyOptional({ description: 'True = leaf node (carries quantity/rate). False = summary section.' })
  @IsOptional()
  @IsBoolean()
  isLeaf?: boolean;

  @ApiPropertyOptional({ example: 'm³' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;

  @ApiPropertyOptional({ example: 120.5 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  quantity?: number;

  @ApiPropertyOptional({ example: 250.0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  unitRate?: number;

  @ApiPropertyOptional({ example: 'USD', maxLength: 3 })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;
}
