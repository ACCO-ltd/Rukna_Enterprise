import { IsString, IsArray, IsEnum, ArrayMinSize } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ProjectRole } from '@erp/types';

export class AddMemberDto {
  @ApiProperty({ example: 'cld...' })
  @IsString()
  userId!: string;

  @ApiProperty({ enum: ProjectRole, isArray: true, example: [ProjectRole.SITE_ENGINEER] })
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(ProjectRole, { each: true })
  roles!: ProjectRole[];
}
