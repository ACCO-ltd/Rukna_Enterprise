import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDecimal, IsDateString, IsOptional } from 'class-validator';

export class AddRetentionTermsDto {
  @ApiProperty({ description: 'Retention deduction rate per IPC (0.0–1.0, e.g. 0.05 = 5%)' })
  @IsDecimal()
  retentionRate!: string;

  @ApiProperty({ description: 'Maximum retention cap as fraction of contract value (e.g. 0.10 = 10%)' })
  @IsDecimal()
  retentionCap!: string;

  @ApiProperty({ description: 'Fraction released on practical completion (e.g. 0.5 = half at PC)' })
  @IsDecimal()
  retentionSplitOnPc!: string;

  @ApiPropertyOptional({ description: 'Date the final retention was released' })
  @IsDateString()
  @IsOptional()
  retentionReleasedAt?: string;
}
