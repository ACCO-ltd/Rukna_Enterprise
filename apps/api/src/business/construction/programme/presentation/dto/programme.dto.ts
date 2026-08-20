import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsDateString, IsInt, Min, MaxLength } from 'class-validator';

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
}

export class VerifyMilestoneDto {
  @ApiProperty({ example: '2026-10-03', description: 'The date the stage actually completed.' })
  @IsDateString()
  actualDate!: string;
}
