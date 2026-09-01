import { IsOptional, IsString, MinLength, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import type { UpdateRoleRequest } from '@erp/types';

export class UpdateRoleDto implements UpdateRoleRequest {
  @ApiPropertyOptional({ example: 'Quantity Surveyor' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: 'Prepares and measures interim valuations' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ example: 'Prepare and review supplier-payment documentation' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  purpose?: string;
}
