import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsDecimal, IsEnum, IsOptional, IsDateString, MaxLength } from 'class-validator';
import { BillingModel } from '@erp/types';

export class UpdateContractDto {
  @ApiPropertyOptional()
  @IsString()
  @MaxLength(50)
  @IsOptional()
  contractNumber?: string;

  @ApiPropertyOptional()
  @IsDecimal()
  @IsOptional()
  contractValue?: string;

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(3)
  @IsOptional()
  currency?: string;

  @ApiPropertyOptional({ enum: BillingModel })
  @IsEnum(BillingModel)
  @IsOptional()
  billingModel?: BillingModel;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  expectedEndDate?: string;
}
