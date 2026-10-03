import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';
import { CASHFLOW_BUCKET_SIZES, type CashflowBucketSize } from '@erp/types';

export class CashflowQueryDto {
  @ApiPropertyOptional({ description: 'One project (project access applies); omit for the portfolio' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  projectId?: string;

  @ApiPropertyOptional({ description: 'First day (ISO date); defaults to today, never before today' })
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @ApiPropertyOptional({ description: 'Last day (ISO date); defaults to 12 weeks / 6 months after from' })
  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;

  @ApiPropertyOptional({ enum: CASHFLOW_BUCKET_SIZES, default: 'WEEK' })
  @IsOptional()
  @IsIn(CASHFLOW_BUCKET_SIZES as unknown as string[])
  bucket?: CashflowBucketSize;
}
