import { IsString, MaxLength, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateMaterialCategoryDto {
  @ApiProperty({ example: 'STEEL' })
  @IsString()
  @MaxLength(30)
  code: string;

  @ApiProperty({ example: 'Steel & Metal Products' })
  @IsString()
  name: string;


  @ApiPropertyOptional({ example: 'CONSTRUCTION_MATERIALS', description: 'Code of parent category' })
  @IsOptional()
  @IsString()
  parentCode?: string;
}
