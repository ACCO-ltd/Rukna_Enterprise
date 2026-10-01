import { IsArray, IsInt, IsISO8601, IsOptional, IsString, MaxLength, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import type { CommercialPreparePackageRequest } from '@erp/types';

/**
 * Commercial redesign D1 — `POST …/installments/:installmentId/prepare-package`. Creates the stage's
 * DRAFT invoice (and one draft per selected variation addition); nothing is numbered or posted.
 */
export class PreparePackageDto implements CommercialPreparePackageRequest {
  @ApiPropertyOptional({
    description:
      'CLIENT_APPROVED variation ids to bill with this stage (positive selection). Omit or [] for the stage only.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  selectedVariationIds?: string[];

  @ApiPropertyOptional({ description: 'Invoice date (ISO 8601). Defaults to today (server, UTC).' })
  @IsOptional()
  @IsISO8601()
  invoiceDate?: string;

  @ApiPropertyOptional({
    description: 'Due date (ISO 8601). Defaults to invoice date + payment terms days.',
  })
  @IsOptional()
  @IsISO8601()
  dueDate?: string;

  @ApiPropertyOptional({
    description: "Payment terms in days. Defaults to the number in the contract's payment terms, else 0.",
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  paymentTermsDays?: number;

  @ApiPropertyOptional({ description: 'Notes printed on every draft of the package.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({
    description:
      'ADR-041 — the sales tax code for every draft in the package. Omitted → the default. Another code needs manage:accounting.',
  })
  @IsOptional()
  @IsString()
  taxCodeId?: string;
}
