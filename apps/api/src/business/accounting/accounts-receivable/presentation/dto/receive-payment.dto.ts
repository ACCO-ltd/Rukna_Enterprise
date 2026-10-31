import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsDecimal,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { RECEIPT_PAYMENT_METHODS, type ReceiptPaymentMethod } from '../../domain/receipt-payment-method.js';
import { PaymentDetailsDto } from './payment-details.dto.js';

export class ReceivePaymentAllocationDto {
  @ApiProperty() @IsString() @IsNotEmpty()
  clientInvoiceId!: string;

  @ApiProperty({ example: 1250 }) @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive()
  amount!: number;
}

/**
 * ADR-046 §6 — receive a customer payment straight into a bank account: the receipt is recorded,
 * posted (Dr that bank's GL account) and applied to the invoices named, in one action.
 */
export class ReceivePaymentDto extends PaymentDetailsDto {
  @ApiProperty() @IsString() @IsNotEmpty()
  clientId!: string;

  @ApiProperty({ description: 'The bank account the money landed in (must accept receipts)' })
  @IsString() @IsNotEmpty()
  bankAccountId!: string;

  @ApiProperty({ example: '2026-10-28' }) @IsDateString()
  receiptDate!: string;

  @ApiProperty({ example: '1250.00' }) @IsDecimal({ decimal_digits: '0,2' })
  amount!: string;

  @ApiProperty({ example: 'USD' }) @IsString() @MaxLength(3)
  currency!: string;

  @ApiProperty({ enum: RECEIPT_PAYMENT_METHODS, description: 'PM-1: required, with the proof its method needs' })
  @IsIn(RECEIPT_PAYMENT_METHODS)
  paymentMethod!: ReceiptPaymentMethod;

  @ApiPropertyOptional({ description: 'Bank reference or payment advice number' })
  @IsOptional() @IsString() @MaxLength(100)
  reference?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500)
  notes?: string;

  @ApiPropertyOptional({ type: [ReceivePaymentAllocationDto], description: 'Invoices this payment settles; the rest stays unapplied on the client' })
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => ReceivePaymentAllocationDto)
  allocations?: ReceivePaymentAllocationDto[];
}
