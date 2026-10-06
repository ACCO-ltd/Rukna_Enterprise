import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class InvoicePaymentAccountDto {
  @ApiProperty({ example: 'Premier Bank' })
  @IsString() @MaxLength(100)
  bankName!: string;

  @ApiProperty({ example: '0102003344' })
  @IsString() @MaxLength(50)
  accountNumber!: string;
}

/** Every field optional: omitted keeps the current value, `null` (or blank) clears it. */
export class UpdateInvoiceDocumentSettingsDto {
  @ApiPropertyOptional({
    type: [InvoicePaymentAccountDto],
    description: 'The "Bank Account Details" rows in print order (max 8); [] removes the table',
  })
  @IsOptional() @IsArray() @ArrayMaxSize(8) @ValidateNested({ each: true }) @Type(() => InvoicePaymentAccountDto)
  paymentAccounts?: InvoicePaymentAccountDto[];

  @ApiPropertyOptional({ nullable: true, description: 'Invoice notes, one per line; null → the default notes' })
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(2000)
  notes?: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'Ahmed Ali' })
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(120)
  signatoryName?: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'Finance Manager' })
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(120)
  signatoryTitle?: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'CONSTRUCTION & DEVELOPMENT' })
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(80)
  tagline?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Footer address, one line per line; null → the legal address' })
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(300)
  footerAddress?: string | null;

  @ApiPropertyOptional({ type: [String], description: 'Up to two phone numbers' })
  @IsOptional() @IsArray() @ArrayMaxSize(2) @IsString({ each: true }) @MaxLength(40, { each: true })
  footerPhones?: string[];

  @ApiPropertyOptional({ nullable: true, example: 'info@acco.com' })
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(254)
  footerEmail?: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'www.acco.com' })
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(200)
  footerWebsite?: string | null;

  @ApiPropertyOptional({ description: 'Print the Bank Account Details section' })
  @IsOptional() @IsBoolean()
  showBankDetails?: boolean;

  @ApiPropertyOptional({ description: 'Print the Notes section' })
  @IsOptional() @IsBoolean()
  showNotes?: boolean;
}
