import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsDateString, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * ADR-030 CONST-COM-028 / S-VB-5 — "Bill this stage": generate the milestone installment's invoice
 * plus one standalone invoice per selected client-approved addition variation, netting selected
 * omissions into the (not-yet-invoiced) milestone subtotal. One atomic package.
 *
 * Uses POSITIVE selection: `selectedVariationIds` names exactly which CLIENT_APPROVED VOs are included
 * in this billing cycle. An empty array means "milestone only — no VOs this cycle".
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
    type: [String],
    description:
      'Explicit list of CLIENT_APPROVED variation IDs to include in this billing cycle. ' +
      'Use [] for milestone only. Unrecognised IDs are rejected.',
  })
  @IsArray()
  @IsString({ each: true })
  selectedVariationIds!: string[];
}
