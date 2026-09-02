import { IsString, IsEnum, MaxLength, MinLength, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProjectCategory } from '@erp/types';

// Project type (PTD1-PTD5): create a subtype under a fixed category. The (category, name) pair is
// unique per organization; a duplicate is a 409.
export class CreateProjectSubtypeDto {
  @ApiProperty({ enum: ProjectCategory, description: 'The fixed category this subtype classifies within.' })
  @IsEnum(ProjectCategory)
  category!: ProjectCategory;

  @ApiProperty({ example: 'Office buildings' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;
}

// Optional category filter for the picker (?category=COMMERCIAL). No filter returns every subtype.
export class ListProjectSubtypesQueryDto {
  @ApiPropertyOptional({ enum: ProjectCategory })
  @IsOptional()
  @IsEnum(ProjectCategory)
  category?: ProjectCategory;
}
