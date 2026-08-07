import { IsString, MaxLength, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSpendCategoryDto {
  @ApiProperty({ example: 'DIRECT_MATERIAL' })
  @IsString()
  @MaxLength(30)
  code: string;

  @ApiProperty({ example: 'Direct Material' })
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nameAr?: string;

  @ApiPropertyOptional({ example: 'PROJECT_COSTS', description: 'Code of parent spend category' })
  @IsOptional()
  @IsString()
  parentCode?: string;
}
