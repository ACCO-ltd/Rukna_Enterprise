import { IsString, IsOptional, IsBoolean, Length, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateDistrictDto {
  @ApiProperty({ example: 'WBR', description: 'Immutable 3-letter code — the district segment of a project code.' })
  @IsString()
  @Length(2, 8)
  code!: string;

  @ApiProperty({ example: 'Waaberi' })
  @IsString()
  @MaxLength(120)
  name!: string;
}

// The code is immutable once set (records key on it). Only the name and active flag change.
export class UpdateDistrictDto {
  @ApiPropertyOptional({ example: 'Waaberi' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ description: 'Deactivate to hide from new-project pickers without deleting history.' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
