import { IsString, IsISO8601, IsOptional, IsArray } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class IssuePackageDto {
  @ApiProperty({ description: 'Invoice date (ISO 8601 date string)' })
  @IsISO8601()
  invoiceDate!: string;

  @ApiProperty({ description: 'Payment due date (ISO 8601 date string)' })
  @IsISO8601()
  dueDate!: string;

  @ApiPropertyOptional({ description: 'Payment terms (e.g. "Net 30")' })
  @IsOptional()
  @IsString()
  paymentTerms?: string;

  @ApiPropertyOptional({ description: 'Optional notes to appear on all package invoices' })
  @IsOptional()
  @IsString()
  notes?: string;

  /**
   * Positive selection: only these CLIENT_APPROVED variation IDs are billed in this package.
   * An empty array means "milestone only — no VOs this billing cycle".
   * Unrecognised IDs are rejected (404) rather than silently ignored.
   */
  @ApiProperty({
    description:
      'Explicit list of CLIENT_APPROVED variation IDs to include in this package. ' +
      'Use [] to issue the milestone invoice only.',
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  selectedVariationIds!: string[];
}
