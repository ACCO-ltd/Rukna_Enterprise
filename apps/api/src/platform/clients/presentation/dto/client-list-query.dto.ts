import { IsEnum, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ClientStatus, ClientType } from '@prisma/client';
import type { ClientListBalanceFilter, ClientListSort } from '@erp/types';

export const CLIENT_LIST_MAX_PAGE_SIZE = 100;
export const CLIENT_LIST_DEFAULT_PAGE_SIZE = 25;

export class ClientListQueryDto {
  @ApiPropertyOptional({ description: 'Name, code or any contact name (case-insensitive)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ enum: ClientStatus })
  @IsOptional()
  @IsEnum(ClientStatus)
  status?: ClientStatus;

  @ApiPropertyOptional({ enum: ClientType })
  @IsOptional()
  @IsEnum(ClientType)
  type?: ClientType;

  @ApiPropertyOptional({ enum: ['OWES', 'OVERDUE'], description: 'Ignored without view:financial-position' })
  @IsOptional()
  @IsIn(['OWES', 'OVERDUE'])
  balance?: ClientListBalanceFilter;

  @ApiPropertyOptional({ enum: ['name', '-name', 'outstanding', '-outstanding'] })
  @IsOptional()
  @IsIn(['name', '-name', 'outstanding', '-outstanding'])
  sort?: ClientListSort;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: CLIENT_LIST_DEFAULT_PAGE_SIZE, minimum: 1, maximum: CLIENT_LIST_MAX_PAGE_SIZE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(CLIENT_LIST_MAX_PAGE_SIZE)
  pageSize?: number;
}

export class ClientActivityQueryDto {
  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
