import { IsString, IsOptional, IsDateString, MaxLength, ValidateNested, ArrayMaxSize } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { WaiverOverrideDto } from './waiver-override.dto.js';

// ADR-019 CONST-PLC-008 — the Start command records only the decision it introduces: the actual
// commencement. Readiness asserts the prerequisites (client, contract, baselined BOQ) already exist;
// the command does not re-collect them. Any unsatisfied WAIVABLE condition must carry an override.
export class StartProjectDto {
  @ApiProperty({ example: '2026-09-01', description: 'The actual project commencement date' })
  @IsDateString()
  actualStartDate!: string;

  @ApiPropertyOptional({ example: 'Site handover completed; mobilization underway' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  commencementNote?: string;

  @ApiPropertyOptional({ type: [WaiverOverrideDto], description: 'Per-condition waivers (CONST-PLC-006)' })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => WaiverOverrideDto)
  @ArrayMaxSize(10)
  overrides?: WaiverOverrideDto[];
}
