import { IsString, MaxLength, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateMaterialDto {
  @ApiProperty({ example: 'REBAR-12MM' })
  @IsString()
  @MaxLength(50)
  code: string;

  @ApiProperty({ example: '12mm Deformed Steel Rebar' })
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nameAr?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: 'STEEL', description: 'Material category code' })
  @IsString()
  materialCategoryCode: string;

  @ApiPropertyOptional({ example: 'DIRECT_MATERIAL', description: 'Default spend category code' })
  @IsOptional()
  @IsString()
  defaultSpendCategoryCode?: string;

  @ApiProperty({ example: 'TON', description: 'Base unit of measure code' })
  @IsString()
  baseUomCode: string;
}
