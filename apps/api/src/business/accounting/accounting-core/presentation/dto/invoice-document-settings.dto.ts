import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

/** Every field optional: omitted keeps the current value, `null` (or blank) clears it. */
export class UpdateInvoiceDocumentSettingsDto {
  @ApiPropertyOptional({ nullable: true, description: 'Bank account printed under Payment Information' })
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(64)
  bankAccountId?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Invoice notes, one per line; null → the default notes' })
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(2000)
  notes?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'User printed as the authorised signatory' })
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(64)
  signatoryUserId?: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'Finance Manager' })
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(120)
  signatoryTitle?: string | null;
}
