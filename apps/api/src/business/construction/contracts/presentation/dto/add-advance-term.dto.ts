import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsDecimal, IsOptional, IsString, MaxLength } from 'class-validator';
import { AdvanceType } from '@erp/types';

export class AddAdvanceTermDto {
  @ApiProperty({ enum: AdvanceType })
  @IsEnum(AdvanceType)
  advanceType!: AdvanceType;

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(255)
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ description: 'Fixed amount (provide either amount or percentage)' })
  @IsDecimal()
  @IsOptional()
  amount?: string;

  @ApiPropertyOptional({ description: 'Percentage of contract value (0.0–1.0)' })
  @IsDecimal()
  @IsOptional()
  percentage?: string;

  @ApiProperty({ description: 'Recovery rate per IPC (0.0–1.0, e.g. 0.15 = 15%)' })
  @IsDecimal()
  recoveryRate!: string;
}
