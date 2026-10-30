import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsDecimal, IsDateString, IsIn, IsOptional, IsNotEmpty, MaxLength } from 'class-validator';
import { RECEIPT_PAYMENT_METHODS, type ReceiptPaymentMethod } from '../../domain/receipt-payment-method.js';
import { PaymentDetailsDto } from './payment-details.dto.js';

// ACC-SET-001 BE-2: moved here from the retired finance module. Records a client receipt
// (NOT_POSTED until it is posted to the GL via /customer-receipts/:id/post).
export class CreateReceiptDto extends PaymentDetailsDto {
  @ApiProperty({ description: 'Client ID who made the payment' })
  @IsString() @IsNotEmpty()
  clientId!: string;

  @ApiProperty({ example: '2026-06-15' })
  @IsDateString()
  receiptDate!: string;

  @ApiProperty({ example: '125000.00' })
  @IsDecimal({ decimal_digits: '0,2' })
  amount!: string;

  @ApiProperty({ example: 'USD', description: 'USD only (ADR-024)' })
  @IsString() @MaxLength(3)
  currency!: string;

  @ApiProperty({ enum: RECEIPT_PAYMENT_METHODS, description: 'PM-1: required, with the proof its method needs' })
  @IsIn(RECEIPT_PAYMENT_METHODS)
  paymentMethod!: ReceiptPaymentMethod;

  @ApiPropertyOptional({ description: 'Bank reference or payment advice number' })
  @IsString() @MaxLength(100) @IsOptional()
  reference?: string;

  @ApiPropertyOptional()
  @IsString() @MaxLength(500) @IsOptional()
  notes?: string;
}
