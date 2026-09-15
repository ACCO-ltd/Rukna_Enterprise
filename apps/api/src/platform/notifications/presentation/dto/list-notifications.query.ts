import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBooleanString, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * ADR-031 — query for `GET /notifications`. `unread` arrives as the string `'true'`/`'false'` (query
 * strings are untyped); the controller coerces it. `page`/`limit` are validated ints with sane bounds.
 */
export class ListNotificationsQuery {
  @ApiPropertyOptional({ description: 'When "true", only unread notifications.', example: 'true' })
  @IsBooleanString()
  @IsOptional()
  unread?: string;

  @ApiPropertyOptional({ example: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({ example: 20, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number;
}
