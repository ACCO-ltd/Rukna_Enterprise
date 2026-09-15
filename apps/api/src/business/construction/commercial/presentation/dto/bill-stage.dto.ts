import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/**
 * ADR-030 CONST-COM-028 / S-VB-5 (Commercial redesign P1) — one eligible variation's include/defer
 * decision for the stage being billed. `include: false` (or omission from the list) defers the VO,
 * which stays billable later.
 */
export class BillStageVariationDecisionDto {
  @ApiProperty({ description: 'VariationOrder ID' })
  @IsString()
  @IsNotEmpty()
  variationId!: string;

  @ApiProperty({ description: 'Bill this variation with the stage now (false = defer)' })
  @IsBoolean()
  include!: boolean;
}

/**
 * ADR-030 CONST-COM-028 / S-VB-5 — "Bill this stage": generate the milestone installment's invoice
 * plus one standalone invoice per included client-approved addition variation, netting included
 * omissions into the (not-yet-invoiced) milestone subtotal. One atomic package.
 */
export class BillStageDto {
  @ApiProperty({ description: 'ContractPaymentInstallment ID being billed' })
  @IsString()
  @IsNotEmpty()
  installmentId!: string;

  @ApiProperty({ example: '2026-06-05' })
  @IsDateString()
  invoiceDate!: string;

  @ApiProperty({ example: '2026-07-05' })
  @IsDateString()
  dueDate!: string;

  @ApiPropertyOptional({ example: 'Net 30' })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  paymentTerms?: string;

  @ApiProperty({
    type: [BillStageVariationDecisionDto],
    description: 'Include/defer decision for each eligible client-approved variation',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BillStageVariationDecisionDto)
  variations!: BillStageVariationDecisionDto[];
}
