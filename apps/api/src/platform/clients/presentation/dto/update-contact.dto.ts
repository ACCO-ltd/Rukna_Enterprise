import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import type { PhoneInput } from '@erp/types';

/** `PATCH /clients/:id/contacts/:contactId` — all optional; `null` clears role / WhatsApp / email. */
export class UpdateContactDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  role?: string | null;

  @ApiPropertyOptional({ description: 'E.164 string or { country, number }. Cannot be cleared.' })
  @IsOptional()
  phone?: PhoneInput;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  whatsappPhone?: PhoneInput | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  email?: string | null;
}
