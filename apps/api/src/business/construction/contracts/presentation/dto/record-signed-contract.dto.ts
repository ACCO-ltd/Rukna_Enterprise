import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsDecimal,
  IsEnum,
  IsOptional,
  IsDateString,
  MaxLength,
  IsNotEmpty,
  IsArray,
  ValidateNested,
  ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { BillingModel } from '@erp/types';

import { PaymentInstallmentDto } from './create-contract.dto.js';

/**
 * Record a physically-signed client contract: create + activate in one step.
 *
 * Unlike `CreateContractDto`, `contractValue` here is what the parties physically agreed and is
 * NOT validated against the live BOQ total. The BOQ snapshot is the reference scope; the signed
 * value is the authoritative `baseContractValue`.
 */
export class RecordSignedContractDto {
  @ApiProperty({ description: 'Project ID this contract belongs to' })
  @IsString()
  @IsNotEmpty()
  projectId!: string;

  @ApiProperty({ description: 'Client ID' })
  @IsString()
  @IsNotEmpty()
  clientId!: string;

  @ApiPropertyOptional({ example: 'ACCO-WBR-26-0065-C1', description: 'Auto-generated if absent' })
  @IsString()
  @MaxLength(50)
  @IsOptional()
  contractNumber?: string;

  @ApiProperty({ example: '2026-09-17', description: 'ISO date the parties physically signed the contract' })
  @IsDateString()
  signedDate!: string;

  @ApiProperty({
    example: '495000.00',
    description: 'Physically agreed contract value — not validated against the BOQ tie-out total',
  })
  @IsDecimal()
  contractValue!: string;

  @ApiPropertyOptional({ enum: BillingModel, default: BillingModel.MILESTONE })
  @IsEnum(BillingModel)
  @IsOptional()
  billingModel?: BillingModel;

  @ApiPropertyOptional({
    example: '30 days from invoice date',
    description: 'Free-text payment terms for invoicing reference',
  })
  @IsString()
  @MaxLength(500)
  @IsOptional()
  paymentTerms?: string;

  @ApiPropertyOptional({
    example: '2026-09-17',
    description: 'Contractual start date — defaults to signedDate when absent',
  })
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ example: '2027-12-31' })
  @IsDateString()
  @IsOptional()
  expectedEndDate?: string;

  @ApiProperty({
    type: [PaymentInstallmentDto],
    description: 'Payment schedule. Σ(percentage) must equal 1 for a MILESTONE contract.',
  })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PaymentInstallmentDto)
  paymentPlan!: PaymentInstallmentDto[];

  @ApiPropertyOptional({
    description: 'Platform file ID (already in READY state) of the signed contract document',
  })
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  signedDocumentId?: string;
}
