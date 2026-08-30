import { IsArray, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import type { SetUserRolesRequest } from '@erp/types';

export class SetUserRolesDto implements SetUserRolesRequest {
  @ApiProperty({ type: [String], description: 'Full desired role-id set for the membership.' })
  @IsArray()
  @IsString({ each: true })
  roleIds!: string[];
}
