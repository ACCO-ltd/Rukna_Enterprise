import { IsDefined, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { PhoneInput } from '@erp/types';

/**
 * A contact as typed. Shape checks only — the real rules (name normalisation, E.164 phone, email)
 * live in `domain/client-input.ts` so every error carries `errorCode` + `field`.
 */
export class ContactInputDto {
  @ApiProperty({ example: 'Ahmed Hassan' })
  @IsString()
  name!: string;

  @ApiPropertyOptional({ example: 'Commercial Director', nullable: true })
  @IsOptional()
  @IsString()
  role?: string | null;

  @ApiProperty({
    description: "E.164 string ('+252612345678') or { country: 'SO', number: '61 234 5678' }",
    example: '+252612345678',
  })
  @IsDefined()
  phone!: PhoneInput;

  @ApiPropertyOptional({ description: 'Same shape as phone', nullable: true })
  @IsOptional()
  whatsappPhone?: PhoneInput | null;

  @ApiPropertyOptional({ example: 'ahmed@example.com', nullable: true })
  @IsOptional()
  @IsString()
  email?: string | null;
}
