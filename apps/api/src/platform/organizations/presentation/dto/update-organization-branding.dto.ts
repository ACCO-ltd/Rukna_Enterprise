import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsHexColor, IsOptional, IsString, MaxLength } from 'class-validator';
import { InvoiceTemplate } from '@erp/types';

/**
 * The invoice header/footer identity (Commercial round-3). Every field is independently
 * optional: `undefined` (omitted) leaves it unchanged, `null` clears it — this is a PATCH, not a
 * replace. `logoFileId` is the id from `POST /files` + `POST /files/:id/confirm`; the service
 * binds it (TEMPORARY → BOUND) once it lands on the organization.
 */
export class UpdateOrganizationBrandingDto {
  @ApiPropertyOptional({ description: 'A confirmed upload id from POST /files/:id/confirm.' })
  @IsString()
  @IsOptional()
  logoFileId?: string | null;

  @ApiPropertyOptional({ description: 'The legal address printed on generated invoices.' })
  @IsString()
  @MaxLength(2000)
  @IsOptional()
  legalAddress?: string | null;

  @ApiPropertyOptional({ description: 'Tax / VAT registration number.' })
  @IsString()
  @MaxLength(100)
  @IsOptional()
  taxRegistrationNumber?: string | null;

  @ApiPropertyOptional({ description: 'Hex color for the invoice header, e.g. "#1E40AF".' })
  @IsHexColor()
  @IsOptional()
  brandColorHex?: string | null;

  @ApiPropertyOptional({ description: 'Freeform note printed in the invoice footer.' })
  @IsString()
  @MaxLength(2000)
  @IsOptional()
  invoiceFooterNote?: string | null;

  @ApiPropertyOptional({ enum: InvoiceTemplate })
  @IsEnum(InvoiceTemplate)
  @IsOptional()
  invoiceTemplate?: InvoiceTemplate;
}
