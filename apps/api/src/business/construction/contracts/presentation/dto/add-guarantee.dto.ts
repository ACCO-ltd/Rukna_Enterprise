import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsDecimal, IsDateString, IsOptional, MaxLength } from 'class-validator';

export class AddGuaranteeDto {
  @ApiProperty({ example: 'PERFORMANCE' })
  @IsString()
  @MaxLength(100)
  guaranteeType!: string;

  @ApiProperty({ example: '250000.00' })
  @IsDecimal()
  amount!: string;

  @ApiProperty({ example: 'USD' })
  @IsString()
  @MaxLength(3)
  currency!: string;

  @ApiProperty({ description: 'Issuing bank or institution' })
  @IsString()
  @MaxLength(255)
  issuer!: string;

  @ApiProperty({ description: 'Beneficiary name' })
  @IsString()
  @MaxLength(255)
  beneficiary!: string;

  @ApiProperty({ example: '2026-03-01' })
  @IsDateString()
  issueDate!: string;

  @ApiProperty({ example: '2027-03-01' })
  @IsDateString()
  expiryDate!: string;

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(500)
  @IsOptional()
  notes?: string;
}
