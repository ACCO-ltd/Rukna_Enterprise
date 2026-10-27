import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsDateString, IsOptional, MaxLength } from 'class-validator';

/** ADR-046 §5 — bill a contract's held retention once its retention has been released. */
export class GenerateInvoiceFromRetentionReleaseDto {
  @ApiProperty({ description: 'Contract whose retention was released' })
  @IsString() @IsNotEmpty()
  contractId!: string;

  @ApiProperty({ example: '2026-11-01' })
  @IsDateString()
  invoiceDate!: string;

  @ApiProperty({ example: '2026-12-01' })
  @IsDateString()
  dueDate!: string;

  @ApiPropertyOptional({ example: 'Net 30' })
  @IsString() @IsOptional() @MaxLength(100)
  paymentTerms?: string;
}
