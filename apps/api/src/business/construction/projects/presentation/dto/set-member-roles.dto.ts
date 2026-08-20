import { IsArray, IsEnum, ArrayMinSize } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ProjectRole } from '@erp/types';

export class SetMemberRolesDto {
  @ApiProperty({ enum: ProjectRole, isArray: true, example: [ProjectRole.PROJECT_MANAGER] })
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(ProjectRole, { each: true })
  roles!: ProjectRole[];
}
