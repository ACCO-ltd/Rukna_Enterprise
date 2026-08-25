import { IsString, IsOptional, IsNotEmpty, IsDateString, MaxLength, ValidateNested, ArrayMaxSize } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { WaiverOverrideDto } from './waiver-override.dto.js';

// ADR-019 CONST-PLC-008 — the Close command records the closure decision (date + summary); it never
// re-collects final-account / commitments / retention facts (those live in their own domains and,
// once queryable, will surface as readiness conditions rather than payload fields).
export class CloseProjectDto {
  @ApiProperty({ example: '2027-09-30', description: 'The date the project was closed' })
  @IsDateString()
  closureDate!: string;

  @ApiProperty({ example: 'Final account agreed, retention released, all obligations discharged.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  closureSummary!: string;

  @ApiPropertyOptional({ type: [WaiverOverrideDto], description: 'Per-condition waivers (CONST-PLC-006)' })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => WaiverOverrideDto)
  @ArrayMaxSize(10)
  overrides?: WaiverOverrideDto[];
}
