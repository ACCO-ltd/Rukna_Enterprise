import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import type { FinanceApprovalSettings } from '@erp/types';

/** ADR-046 §8. Amount rules (two decimals, not negative) are the domain's, listed all at once. */
export class UpdateApprovalSettingsDto implements FinanceApprovalSettings {
  @ApiProperty({ nullable: true, example: '5000.00', description: 'Invoices at or above need Approve; null = never' })
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(20)
  invoiceApprovalAbove!: string | null;

  @ApiProperty({ nullable: true, example: null, description: 'Non-PO bills at or above need approval; null = never' })
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(20)
  billApprovalAbove!: string | null;

  @ApiProperty({ example: false })
  @IsBoolean()
  autoPostToleratedBills!: boolean;

  @ApiProperty({ example: '1000.00', description: 'Payments up to this are approved on Save; "0" = never' })
  @IsString() @MaxLength(20)
  paymentAutoApproveUpTo!: string;

  @ApiProperty({ required: false, example: '50.00', description: 'AR-4 — write-offs above this need a second person; "0" = every one. Kept when omitted.' })
  @IsOptional() @IsString() @MaxLength(20)
  writeOffApprovalAbove?: string;
}
