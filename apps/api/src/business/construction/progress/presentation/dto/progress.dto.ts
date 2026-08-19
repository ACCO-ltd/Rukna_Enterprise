import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsInt, IsNumber, Min, IsDateString, MaxLength } from 'class-validator';

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
