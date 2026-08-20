import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsDateString, IsOptional, MaxLength } from 'class-validator';

// ADR-023: generate a client invoice from a payment-schedule installment (MILESTONE contract).
export class GenerateInvoiceFromInstallmentDto {
  @ApiProperty({ description: 'ContractPaymentInstallment ID' })
  @IsString() @IsNotEmpty()
  installmentId!: string;

  @ApiProperty({ example: '2026-06-05' })
  @IsDateString()
  invoiceDate!: string;

  @ApiProperty({ example: '2026-07-05' })
  @IsDateString()
  dueDate!: string;

  @ApiPropertyOptional({ example: 'Net 30' })
  @IsString() @IsOptional() @MaxLength(100)
  paymentTerms?: string;
}
