import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
  IsInt,
  Min,
  MaxLength,
} from 'class-validator';

/** Upper bound on a milestone's linked package set — a stage is a handful of packages, not hundreds. */
const MAX_LINKED_WORK_PACKAGES = 200;

export class CreateMilestoneDto {
  @ApiProperty({ example: 'MS-01' })
  @IsString() @IsNotEmpty() @MaxLength(50)
  code!: string;

  @ApiProperty({ example: 'Substructure complete' })
  @IsString() @IsNotEmpty() @MaxLength(255)
  name!: string;

  @ApiProperty({ example: '2026-10-01', description: 'Baseline (planned) date for the stage.' })
  @IsDateString()
  baselineDate!: string;

  @ApiPropertyOptional({ example: '2026-10-15', description: 'Revised/forecast date, if known.' })
  @IsDateString() @IsOptional()
  forecastDate?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsInt() @Min(0) @IsOptional()
  sortOrder?: number;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Work packages (same project, measurable) that make up this stage. The milestone reads ' +
      'readyToVerify once every linked package is 100% verified. ADR-021 amendment 2026-09-28.',
  })
  @IsOptional() @IsArray() @ArrayMaxSize(MAX_LINKED_WORK_PACKAGES) @IsString({ each: true })
  workPackageIds?: string[];
}

/** PUT .../milestones/:milestoneId/work-packages — replaces the linked set (empty array clears it). */
export class SetMilestoneWorkPackagesDto {
  @ApiProperty({ type: [String], example: ['wp_01', 'wp_02'] })
  @IsArray() @ArrayMaxSize(MAX_LINKED_WORK_PACKAGES) @IsString({ each: true })
  workPackageIds!: string[];
}

export class VerifyMilestoneDto {
  @ApiProperty({ example: '2026-10-03', description: 'The date the stage actually completed.' })
  @IsDateString()
  actualDate!: string;
}
