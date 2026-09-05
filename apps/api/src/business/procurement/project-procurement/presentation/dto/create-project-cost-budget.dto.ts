import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * One budgeted amount, coded the way cost is coded: against a BOQ node, or against a spend
 * category for project cost that legitimately has no BOQ line (site office, transport,
 * insurance). Exactly one — the service rejects both and neither.
 */
export class ProjectCostBudgetLineDto {
  @ApiPropertyOptional({ description: 'BOQ node this budget line is coded to' })
  @IsString()
  @IsOptional()
  boqNodeId?: string;

  @ApiPropertyOptional({ description: 'Spend category, for project cost with no BOQ line' })
  @IsString()
  @IsOptional()
  spendCategoryId?: string;

  @ApiProperty({ example: 'Substructure concrete' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  description!: string;

  @ApiProperty({ example: 600000, description: 'Budgeted cost. Never a client selling value.' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  budgetAmount!: number;
}

export class CreateProjectCostBudgetDto {
  @ApiProperty({ example: 'USD' })
  @IsString()
  @MaxLength(3)
  currency!: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiProperty({ type: [ProjectCostBudgetLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => ProjectCostBudgetLineDto)
  lines!: ProjectCostBudgetLineDto[];
}
