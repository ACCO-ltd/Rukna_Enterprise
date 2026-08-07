import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsDateString, IsOptional } from 'class-validator';

export class LedgerQueryDto {
  @ApiProperty({ example: '2025-01-01' })
  @IsDateString()
  fromDate!: string;

  @ApiProperty({ example: '2025-01-31' })
  @IsDateString()
  toDate!: string;

  @ApiPropertyOptional()
  @IsString() @IsOptional()
  projectId?: string;

  @ApiPropertyOptional()
  @IsString() @IsOptional()
  departmentId?: string;

  @ApiPropertyOptional()
  @IsString() @IsOptional()
  costCenterId?: string;
}
