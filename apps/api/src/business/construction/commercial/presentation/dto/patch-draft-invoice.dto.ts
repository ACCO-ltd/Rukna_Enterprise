import { IsDateString, IsOptional, IsString } from 'class-validator';

/**
 * PATCH metadata on a NOT_POSTED (DRAFT) client invoice.
 * Only dueDate, paymentTerms, and notes may be changed.
 * Amount, source identity, client, contract, and currency are immutable.
 */
export class PatchDraftInvoiceDto {
  /** ISO-8601 date string, or null to clear the due date. */
  @IsOptional()
  @IsDateString()
  dueDate?: string | null;

  @IsOptional()
  @IsString()
  paymentTerms?: string | null;

  @IsOptional()
  @IsString()
  notes?: string | null;
}
