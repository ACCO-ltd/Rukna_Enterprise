import { IsArray, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import type { SetRolePermissionsRequest } from '@erp/types';

export class SetRolePermissionsDto implements SetRolePermissionsRequest {
  @ApiProperty({ type: [String], description: 'Full desired permission-id set for the role.' })
  @IsArray()
  @IsString({ each: true })
  permissionIds!: string[];
}
