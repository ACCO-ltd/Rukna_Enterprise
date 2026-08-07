import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsBoolean, IsString } from 'class-validator';
import { Transform } from 'class-transformer';

export class TrialBalanceQueryDto {
  @ApiProperty({ example: '2025-01-31', description: 'Report as of this date' })
  @IsDateString()
  asOfDate!: string;

  @ApiPropertyOptional({ default: false, description: 'Include accounts with zero closing balance' })
  @IsBoolean() @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  includeZeroBalance?: boolean;
}

export class PLQueryDto {
  @ApiProperty({ example: '2025-01-01' })
  @IsDateString()
  fromDate!: string;

  @ApiProperty({ example: '2025-01-31' })
  @IsDateString()
  toDate!: string;

  @ApiPropertyOptional({ description: 'Filter by project ID' })
  @IsString() @IsOptional()
  projectId?: string;

  @ApiPropertyOptional({ description: 'Filter by department ID' })
  @IsString() @IsOptional()
  departmentId?: string;
}

export class BalanceSheetQueryDto {
  @ApiProperty({ example: '2025-01-31' })
  @IsDateString()
  asOfDate!: string;

  @ApiPropertyOptional({ example: '2024-01-31', description: 'Comparative period date' })
  @IsDateString() @IsOptional()
  comparativeDate?: string;
}
