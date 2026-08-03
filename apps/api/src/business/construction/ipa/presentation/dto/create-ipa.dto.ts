import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsDateString, IsOptional, IsDecimal, MaxLength } from 'class-validator';

export class CreateIpaDto {
  @ApiProperty({ description: 'Contract ID this application belongs to' })
  @IsString()
  @IsNotEmpty()
  contractId!: string;

  @ApiPropertyOptional({ example: '2026-05-01' })
  @IsDateString()
  @IsOptional()
  periodFrom?: string;

  @ApiPropertyOptional({ example: '2026-05-31' })
  @IsDateString()
  @IsOptional()
  periodTo?: string;

  @ApiPropertyOptional({ description: 'Exchange rate currency (e.g. USD)' })
  @IsString()
  @MaxLength(3)
  @IsOptional()
  exchangeRateCurrency?: string;

  @ApiPropertyOptional({ description: 'Exchange rate base currency (e.g. SOS)' })
  @IsString()
  @MaxLength(3)
  @IsOptional()
  exchangeRateBase?: string;

  @ApiPropertyOptional({ description: 'Exchange rate value at application date' })
  @IsDecimal()
  @IsOptional()
  exchangeRateValue?: string;

  @ApiPropertyOptional({ example: '2026-05-31' })
  @IsDateString()
  @IsOptional()
  exchangeRateDate?: string;

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(1000)
  @IsOptional()
  notes?: string;
}
