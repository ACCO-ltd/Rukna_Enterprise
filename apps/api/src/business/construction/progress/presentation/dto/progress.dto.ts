import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsInt, IsNumber, IsBoolean, Min, Max, IsDateString, MaxLength, ValidateNested, ArrayMaxSize } from 'class-validator';
import { Type } from 'class-transformer';

// ADR-021 CONST-PROG-005 — programme activity (time layer under a work package).
export class CreateProgrammeActivityDto {
  @ApiProperty()
  @IsString() @IsNotEmpty() @MaxLength(50)
  code!: string;

  @ApiProperty()
  @IsString() @IsNotEmpty() @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ example: '2026-09-01' })
  @IsOptional() @IsDateString()
  plannedStart?: string;

  @ApiPropertyOptional({ example: '2026-09-30' })
  @IsOptional() @IsDateString()
  plannedEnd?: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional() @IsInt() @Min(0)
  durationDays?: number;

  @ApiPropertyOptional()
  @IsOptional() @IsBoolean()
  isMilestone?: boolean;

  @ApiPropertyOptional()
  @IsOptional() @IsInt()
  sortOrder?: number;
}

export class UpdateProgrammeActivityDto {
  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional() @IsDateString()
  plannedStart?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional() @IsDateString()
  plannedEnd?: string | null;

  @ApiPropertyOptional({ minimum: 0, nullable: true })
  @IsOptional() @IsInt() @Min(0)
  durationDays?: number | null;

  @ApiPropertyOptional()
  @IsOptional() @IsBoolean()
  isMilestone?: boolean;

  @ApiPropertyOptional()
  @IsOptional() @IsInt()
  sortOrder?: number;
}

// ADR-021 CONST-PROG-011 — the approved planned-progress curve (monthly milestones).
export class ProgressTargetItemDto {
  @ApiProperty({ example: '2026-09-30' })
  @IsDateString()
  targetDate!: string;

  @ApiProperty({ example: 25, description: 'Planned cumulative % by this date (0–100)' })
  @IsNumber()
  @Min(0)
  @Max(100)
  cumulativePercent!: number;
}

export class SetProgressTargetsDto {
  @ApiProperty({ type: [ProgressTargetItemDto] })
  @ValidateNested({ each: true })
  @Type(() => ProgressTargetItemDto)
  @ArrayMaxSize(240)
  targets!: ProgressTargetItemDto[];
}

export class CreateDprDto {
  @ApiProperty({ example: '2026-08-18' })
  @IsDateString()
  reportDate!: string;

  @ApiPropertyOptional({ example: 'Clear' })
  @IsString() @IsOptional() @MaxLength(120)
  weather?: string;

  @ApiPropertyOptional({ example: 24 })
  @IsInt() @Min(0) @IsOptional()
  labourCount?: number;

  @ApiPropertyOptional({ example: '1 concrete pump' })
  @IsString() @IsOptional() @MaxLength(255)
  equipmentNote?: string;

  @ApiPropertyOptional()
  @IsString() @IsOptional()
  narrative?: string;

  @ApiPropertyOptional({ description: 'What prevented planned work (weather, material, etc.)' })
  @IsString() @IsOptional() @MaxLength(255)
  delayReason?: string;
}

export class AddMeasurementDto {
  @ApiProperty({ description: 'BOQ leaf node id' })
  @IsString() @IsNotEmpty()
  boqNodeId!: string;

  @ApiProperty({ example: 120, description: 'Quantity measured this report' })
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0)
  quantity!: number;

  @ApiPropertyOptional()
  @IsString() @IsOptional() @MaxLength(255)
  notes?: string;
}

export class AttachEvidenceDto {
  @ApiProperty({ description: 'A confirmed (READY) PlatformFile id' })
  @IsString() @IsNotEmpty()
  platformFileId!: string;
}

export class ReturnDprDto {
  @ApiProperty({ example: 'Measurement for grid 3 looks high — please recheck' })
  @IsString() @IsNotEmpty() @MaxLength(255)
  reason!: string;
}

export class CreateWorkPackageDto {
  @ApiProperty({ example: 'WP-01' })
  @IsString() @IsNotEmpty() @MaxLength(50)
  code!: string;

  @ApiProperty({ example: 'Substructure' })
  @IsString() @IsNotEmpty() @MaxLength(255)
  name!: string;

  @ApiPropertyOptional({ example: 'Ahmed Ali' })
  @IsString() @IsOptional() @MaxLength(255)
  responsibleOwner?: string;

  @ApiPropertyOptional({ example: 0.35, description: 'Fraction of project weight (0..1)' })
  @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @IsOptional()
  progressWeight?: number;
}

export class AllocateBoqNodeDto {
  @ApiProperty({ description: 'A BOQ leaf node id' })
  @IsString() @IsNotEmpty()
  boqNodeId!: string;
}
