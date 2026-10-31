import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

// Shape only — the rules (prices to cents, income accounts, active client) live in
// domain/manual-invoice.policy.ts and ClientInvoiceService.prepareManual, which return every
// problem at once.

export class ManualInvoiceLineDto {
  @ApiProperty({ example: 'Excavator hire — 3 days' })
  @IsString()
  @MaxLength(300)
  description!: string;

  @ApiProperty({ example: '3', description: 'Decimal string, up to 3 dp' })
  @IsNumberString()
  quantity!: string;

  @ApiProperty({ example: '450.00', description: 'Decimal string, up to 2 dp' })
  @IsNumberString()
  unitPrice!: string;

  @ApiProperty({ example: '42100', description: 'An active, posting INCOME account code' })
  @IsString()
  @MaxLength(20)
  revenueAccountCode!: string;
}

export class ManualInvoiceDto {
  @ApiProperty()
  @IsString()
  clientId!: string;

  @ApiProperty({ example: '2026-10-28' })
  @IsDateString()
  invoiceDate!: string;

  @ApiProperty({ example: '2026-11-12' })
  @IsDateString()
  dueDate!: string;

  @ApiProperty({ example: 'USD' })
  @IsString()
  @MaxLength(3)
  currencyCode!: string;

  @ApiPropertyOptional({ example: 'Net 15' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  paymentTerms?: string;

  @ApiPropertyOptional({ example: 'PO-4471', description: "The client's purchase order or job number" })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  clientReference?: string;

  @ApiPropertyOptional({ example: 'Crane hire for site B, week 42.', description: 'A note to the client printed on the invoice' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiProperty({ type: [ManualInvoiceLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ManualInvoiceLineDto)
  lines!: ManualInvoiceLineDto[];
}
