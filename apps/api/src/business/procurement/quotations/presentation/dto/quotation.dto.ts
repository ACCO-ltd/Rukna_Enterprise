import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/** ADR-044 §12 request bodies. No collector body accepts a money field. */

export const QUOTE_PHOTO_SOURCES = ['CAMERA', 'GALLERY', 'UNKNOWN'] as const;
export const QUOTE_COUNT_EXCEPTION_REASONS = ['ONLY_ONE_SUPPLIER', 'URGENT', 'FRAMEWORK_SUPPLIER'] as const;

export class OpenQuotationRequestDto {
  @ApiProperty({ description: 'An APPROVED material request with nothing ordered yet' })
  @IsString()
  @IsNotEmpty()
  materialRequestId: string;
}

export class QuotePhotoDto {
  @ApiProperty({ description: 'A READY, TEMPORARY image the caller uploaded through POST /files' })
  @IsString()
  @IsNotEmpty()
  platformFileId: string;

  @ApiProperty({ example: '2026-10-07T10:31:00.000Z', description: 'Device time at capture (not proof)' })
  @IsDateString()
  capturedAt: string;

  @ApiProperty({ enum: QUOTE_PHOTO_SOURCES, description: 'Best-effort provenance hint (ADR-044 §9)' })
  @IsIn(QUOTE_PHOTO_SOURCES)
  source: (typeof QUOTE_PHOTO_SOURCES)[number];
}

export class AddQuoteDto {
  @ApiProperty({ description: "Idempotency key from the phone's upload queue (uuid)" })
  @IsUUID()
  clientRef: string;

  @ApiPropertyOptional({ description: 'A registered supplier — XOR storeName' })
  @IsOptional()
  @IsString()
  supplierId?: string;

  @ApiPropertyOptional({ description: 'A new store — XOR supplierId', maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  storeName?: string;

  @ApiPropertyOptional({ description: 'Replace this ACTIVE quote (it becomes WITHDRAWN)' })
  @IsOptional()
  @IsString()
  replacesQuoteId?: string;

  @ApiProperty({ type: [QuotePhotoDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => QuotePhotoDto)
  photos: QuotePhotoDto[];
}

export class SendQuotationDto {
  @ApiPropertyOptional({
    enum: QUOTE_COUNT_EXCEPTION_REASONS,
    description: 'Required when fewer distinct stores than requiredQuoteCount',
  })
  @IsOptional()
  @IsIn(QUOTE_COUNT_EXCEPTION_REASONS)
  exceptionReason?: (typeof QUOTE_COUNT_EXCEPTION_REASONS)[number];
}

export const QUOTE_REJECT_REASONS = ['ILLEGIBLE', 'WRONG_ITEMS', 'INCOMPLETE', 'OTHER'] as const;

export class EnterQuoteTotalDto {
  @ApiProperty({ example: '1234.50', description: 'Positive, at most 2 decimals, ≤ 999,999,999.99' })
  @IsString()
  @IsNotEmpty()
  total: string;
}

export class RejectQuoteDto {
  @ApiProperty({ enum: QUOTE_REJECT_REASONS })
  @IsIn(QUOTE_REJECT_REASONS)
  reason: (typeof QUOTE_REJECT_REASONS)[number];

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class AskAnotherQuoteDto {
  @ApiProperty({ maxLength: 1000, example: 'Check Xamar Steel too' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  note: string;
}

export const QUOTATION_PAYMENT_PATHS = ['BUYER_CASH', 'FINANCE_PAYS_SUPPLIER'] as const;
export const NON_LOWEST_REASONS = ['FASTER_DELIVERY', 'BETTER_QUALITY', 'HAS_STOCK', 'OTHER'] as const;

/** Propose with the full body; re-drive a pending award with the same body or `{}`. */
export class AwardQuotationDto {
  @ApiPropertyOptional({ description: 'Required to propose; on re-drive must match the pending choice' })
  @IsOptional()
  @IsString()
  quoteId?: string;

  @ApiPropertyOptional({ enum: QUOTATION_PAYMENT_PATHS, description: 'Required to propose (recorded only in Phase 1)' })
  @IsOptional()
  @IsIn(QUOTATION_PAYMENT_PATHS)
  paymentPath?: (typeof QUOTATION_PAYMENT_PATHS)[number];

  @ApiPropertyOptional({ enum: NON_LOWEST_REASONS, description: 'Required when the chosen quote is not lowest' })
  @IsOptional()
  @IsIn(NON_LOWEST_REASONS)
  nonLowestReason?: (typeof NON_LOWEST_REASONS)[number];

  @ApiPropertyOptional({ maxLength: 1000, description: 'Required with nonLowestReason OTHER' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  nonLowestNote?: string;

  @ApiPropertyOptional({ description: "Accept the collector's exception when fewer stores than required" })
  @IsOptional()
  @IsBoolean()
  acceptException?: boolean;

  @ApiPropertyOptional({ description: 'For a new-store quote: award to this existing registered supplier' })
  @IsOptional()
  @IsString()
  awardSupplierId?: string;
}

export class QuotationReasonDto {
  @ApiProperty({ maxLength: 1000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason: string;
}
