import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString, IsNotEmpty, IsDateString, IsArray, IsOptional,
  IsNumber, Min, ValidateNested, MaxLength, IsIn,
} from 'class-validator';
import { SUPPLIER_PAYMENT_METHODS } from '../../domain/supplier-payment-rules.js';
import { Type } from 'class-transformer';

export class PaymentAllocationDto {
  @ApiProperty()
  @IsString() @IsNotEmpty()
  supplierBillId!: string;

  @ApiProperty({ example: 5000 })
  @IsNumber() @Min(0.01)
  amount!: number;
}

export class CreateSupplierPaymentDto {
  @ApiProperty()
  @IsString() @IsNotEmpty()
  supplierId!: string;

  @ApiProperty({ description: 'Bank account ID to pay from' })
  @IsString() @IsNotEmpty()
  bankAccountId!: string;

  @ApiProperty({ example: '2025-01-20' })
  @IsDateString()
  paymentDate!: string;

  @ApiPropertyOptional({ example: '2025-01-20', description: 'Defaults to paymentDate if omitted' })
  @IsDateString() @IsOptional()
  accountingDate?: string;

  @ApiProperty({ example: 'USD' })
  @IsString() @IsNotEmpty() @MaxLength(3)
  currencyCode!: string;


  @ApiProperty({ example: 10000 })
  @IsNumber() @Min(0.01)
  totalAmount!: number;

  @ApiProperty({ enum: SUPPLIER_PAYMENT_METHODS, example: 'BANK_TRANSFER' })
  @IsIn(SUPPLIER_PAYMENT_METHODS as unknown as string[], { message: 'Choose how the supplier was paid: bank transfer, cheque, cash, mobile money or card.' })
  paymentMethod!: string;

  @ApiPropertyOptional({ example: 'TRF-2025-001', description: 'The cheque number, transfer reference, transaction ID or cash receipt number' })
  @IsString() @IsOptional() @MaxLength(100)
  bankReference?: string;

  @ApiPropertyOptional({ example: '2026-10-30', description: 'SP-3: cheque date (cheque only)' })
  @IsDateString() @IsOptional()
  instrumentDate?: string;

  @ApiPropertyOptional({ example: 'EVC_PLUS', description: 'SP-3: mobile-money provider (mobile money only)' })
  @IsString() @IsOptional() @MaxLength(20)
  provider?: string;

  @ApiPropertyOptional({ description: "SP-3: the supplier's account number or phone paid to" })
  @IsString() @IsOptional() @MaxLength(50)
  payeeAccount?: string;

  @ApiPropertyOptional({ description: 'SP-3: the name on the cheque or account, or who took the cash' })
  @IsString() @IsOptional() @MaxLength(150)
  payeeName?: string;

  @ApiPropertyOptional()
  @IsString() @IsOptional() @MaxLength(500)
  notes?: string;

  @ApiPropertyOptional({ type: [PaymentAllocationDto], description: 'Allocate against bills at payment time' })
  @IsArray() @IsOptional() @ValidateNested({ each: true }) @Type(() => PaymentAllocationDto)
  allocations?: PaymentAllocationDto[];
}
