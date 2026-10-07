import { IsBoolean, IsOptional, IsString, MinLength, MaxLength, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import type { UpdateUserRequest } from '@erp/types';

// Profile edit + WhatsApp alert settings (ADR-044 phase 2). Email is an auth identity and is out of
// scope for v1. The number's validity (E.164) is checked by the service (staff-whatsapp.policy).
export class UpdateUserDto implements UpdateUserRequest {
  @ApiPropertyOptional({ example: 'Jane' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Doe' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName?: string;

  @ApiPropertyOptional({ example: '+252612345678', nullable: true, description: 'E.164; null or "" clears it' })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(32)
  whatsappPhone?: string | null;

  @ApiPropertyOptional({ example: true, description: 'Send WhatsApp alerts (needs a number)' })
  @IsOptional()
  @IsBoolean()
  whatsappAlertsEnabled?: boolean;
}
