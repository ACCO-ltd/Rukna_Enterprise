import { IsString, IsOptional, IsInt, Min } from 'class-validator';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';

export class MoveNodeDto {
  @ApiPropertyOptional({ description: 'New parent node ID — omit to move to root level' })
  @IsOptional()
  @IsString()
  newParentId?: string;

  @ApiProperty({ description: 'New sort order among the destination siblings', example: 2 })
  @IsInt()
  @Min(0)
  newSortOrder!: number;
}
