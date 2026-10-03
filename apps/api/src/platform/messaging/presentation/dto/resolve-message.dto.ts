import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** `POST /communications/:id/resolve` — settle a message WhatsApp never confirmed (UNKNOWN). */
export class ResolveMessageDto {
  @ApiProperty({ enum: ['SENT', 'FAILED'], description: 'What checking with the client showed' })
  @IsIn(['SENT', 'FAILED'])
  outcome!: 'SENT' | 'FAILED';

  @ApiPropertyOptional({ description: 'Why, in your words (kept in the audit log)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
