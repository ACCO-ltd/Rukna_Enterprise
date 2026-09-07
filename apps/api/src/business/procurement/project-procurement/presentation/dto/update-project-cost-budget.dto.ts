import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import { ProjectCostBudgetLineDto } from './create-project-cost-budget.dto.js';

/** DRAFT only. A baselined budget is immutable — re-budget by creating the next version. */
export class UpdateProjectCostBudgetDto {
  @ApiPropertyOptional({ example: 'USD' })
  @IsString()
  @MaxLength(3)
  @IsOptional()
  currency?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiPropertyOptional({
    type: [ProjectCostBudgetLineDto],
    description: 'Replaces every line. Omit to leave the lines untouched.',
  })
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => ProjectCostBudgetLineDto)
  @IsOptional()
  lines?: ProjectCostBudgetLineDto[];
}
