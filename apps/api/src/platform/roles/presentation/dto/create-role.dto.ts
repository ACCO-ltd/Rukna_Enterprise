import { IsArray, IsNotEmpty, IsOptional, IsString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { CreateRoleRequest } from '@erp/types';

export class CreateRoleDto implements CreateRoleRequest {
  @ApiProperty({ example: 'Quantity Surveyor' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ example: 'Prepares and measures interim valuations' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ example: 'Prepare and review supplier-payment documentation' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  purpose!: string;

  @ApiPropertyOptional({ description: 'Role to clone permissions from in the active organization.' })
  @IsOptional()
  @IsString()
  templateRoleId?: string;

  @ApiPropertyOptional({ type: [String], description: 'Permission catalogue ids to grant.' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissionIds?: string[];
}
