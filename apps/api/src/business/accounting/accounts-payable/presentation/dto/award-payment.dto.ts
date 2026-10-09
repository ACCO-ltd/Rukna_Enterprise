import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

/** ADR-045 — money in requests is a string with up to 2 dp ("980.00"); a number is accepted too. */
const MONEY = /^\d+(\.\d{1,2})?$/;

export const ADVANCE_METHODS = ['CASH', 'MOBILE_MONEY', 'BANK'] as const;

export class ReleaseBuyerAdvanceDto {
  @ApiProperty({ description: 'Client key generated once per dialog open (uuid); a double tap returns the first advance' })
  @IsString() @IsNotEmpty() @MaxLength(100)
  idempotencyKey!: string;

  @ApiPropertyOptional({ description: 'The awarded quotation request (or give purchaseOrderId)' })
  @IsOptional() @IsString()
  quotationRequestId?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  purchaseOrderId?: string;

  @ApiProperty({ description: 'The collector receiving the cash' })
  @IsString() @IsNotEmpty()
  recipientUserId!: string;

  @ApiProperty({ example: '1000.00' })
  @Matches(MONEY, { message: 'amount must be a positive amount with at most 2 decimals' })
  amount!: string;

  @ApiProperty({ description: 'Cash box / mobile-money float / bank account without signatories' })
  @IsString() @IsNotEmpty()
  bankAccountId!: string;

  @ApiProperty({ enum: ADVANCE_METHODS })
  @IsIn(ADVANCE_METHODS)
  paymentMethod!: (typeof ADVANCE_METHODS)[number];

  @ApiProperty({ example: '2026-10-08', description: 'The day the cash was handed over (the accounting date)' })
  @IsDateString()
  advancedAt!: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional() @IsString() @MaxLength(100)
  reference?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional() @IsString() @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({ description: 'Top-up: apply the new advance to this posted bill in the same command' })
  @IsOptional() @IsString()
  applyToBillId?: string;
}

export class ReverseBuyerAdvanceDto {
  @ApiProperty({ maxLength: 500 })
  @IsString() @IsNotEmpty() @MaxLength(500)
  reason!: string;

  @ApiPropertyOptional({ example: '2026-10-09', description: 'Required for a posted advance (≥ advancedAt)' })
  @IsOptional() @IsDateString()
  reversalDate?: string;
}

export class CreateAdvanceApplicationDto {
  @ApiPropertyOptional({ description: 'Client key (once per dialog open); a double tap records one application' })
  @IsOptional() @IsString() @MaxLength(100)
  idempotencyKey?: string;

  @ApiProperty()
  @IsString() @IsNotEmpty()
  supplierBillId!: string;

  @ApiPropertyOptional({ example: '980.00', description: 'Default: min(bill outstanding, advance outstanding)' })
  @IsOptional() @Matches(MONEY, { message: 'amount must be a positive amount with at most 2 decimals' })
  amount?: string;
}

export class ReverseAdvanceApplicationDto {
  @ApiProperty({ maxLength: 500 })
  @IsString() @IsNotEmpty() @MaxLength(500)
  reason!: string;
}

export enum PaySupplierShapeDto {
  PREPAY = 'PREPAY',
  PAY_BILL = 'PAY_BILL',
}

export class PayFromAwardDto {
  @ApiProperty()
  @IsString() @IsNotEmpty() @MaxLength(100)
  idempotencyKey!: string;

  @ApiProperty()
  @IsString() @IsNotEmpty()
  quotationRequestId!: string;

  @ApiProperty()
  @IsString() @IsNotEmpty()
  bankAccountId!: string;

  // QA: CASH — the store is paid in cash from the cash box (the GL is the account's, as for any method).
  @ApiProperty({ enum: ['BANK', 'MOBILE_MONEY', 'CASH'] })
  @IsIn(['BANK', 'MOBILE_MONEY', 'CASH'])
  paymentMethod!: 'BANK' | 'MOBILE_MONEY' | 'CASH';

  @ApiProperty({ example: '2026-10-08' })
  @IsDateString()
  paymentDate!: string;

  @ApiProperty({ example: '1000.00' })
  @Matches(MONEY, { message: 'amount must be a positive amount with at most 2 decimals' })
  amount!: string;

  @ApiProperty({ enum: PaySupplierShapeDto })
  @IsEnum(PaySupplierShapeDto)
  shape!: PaySupplierShapeDto;

  @ApiPropertyOptional({ description: 'PAY_BILL: the posted bill on this order' })
  @IsOptional() @IsString()
  supplierBillId?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional() @IsString() @MaxLength(100)
  bankReference?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional() @IsString() @MaxLength(500)
  note?: string;
}
