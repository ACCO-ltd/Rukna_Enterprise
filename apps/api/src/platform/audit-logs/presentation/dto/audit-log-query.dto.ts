import { IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export const AUDIT_LOG_MAX_PAGE_SIZE = 100;
export const AUDIT_LOG_DEFAULT_PAGE_SIZE = 50;

export class AuditLogQueryDto {
  @ApiPropertyOptional({ description: 'Action, resource, record id, reason, or the person (name or email)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ description: 'Exact resource, e.g. "client-invoice"' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  resource?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  userId?: string;

  @ApiPropertyOptional({ description: 'Inclusive, YYYY-MM-DD' })
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @ApiPropertyOptional({ description: 'Inclusive, YYYY-MM-DD' })
  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: AUDIT_LOG_DEFAULT_PAGE_SIZE, minimum: 1, maximum: AUDIT_LOG_MAX_PAGE_SIZE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(AUDIT_LOG_MAX_PAGE_SIZE)
  pageSize?: number;
}
