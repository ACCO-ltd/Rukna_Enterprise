import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsDecimal, IsOptional, MaxLength } from 'class-validator';

export class AddIpaDeductionDto {
  @ApiProperty({ description: 'Deduction type: RETENTION, ADVANCE_RECOVERY, TAX, or custom' })
  @IsString()
  @MaxLength(100)
  deductionType!: string;

  @ApiPropertyOptional({ description: 'Source ContractRetentionTerms or ContractAdvanceTerm ID' })
  @IsString()
  @IsOptional()
  sourceTermId?: string;

  @ApiPropertyOptional({ description: 'Rate applied to basis (0.0–1.0)' })
  @IsDecimal()
  @IsOptional()
  rate?: string;

  @ApiProperty({ description: 'Amount the rate is applied to (gross period value)' })
  @IsDecimal()
  basis!: string;

  @ApiProperty({ description: 'Computed deduction amount' })
  @IsDecimal()
  amount!: string;
}
