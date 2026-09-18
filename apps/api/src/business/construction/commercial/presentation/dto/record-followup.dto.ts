import { IsString, IsISO8601, IsOptional, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const FOLLOW_UP_METHODS = ['WHATSAPP', 'EMAIL', 'PHONE', 'PHYSICAL', 'OTHER'] as const;

export class RecordFollowUpDto {
  @ApiProperty({ enum: FOLLOW_UP_METHODS, description: 'How the follow-up was conducted' })
  @IsIn(FOLLOW_UP_METHODS)
  method!: 'WHATSAPP' | 'EMAIL' | 'PHONE' | 'PHYSICAL' | 'OTHER';

  @ApiPropertyOptional({ description: 'Name of the person contacted' })
  @IsOptional()
  @IsString()
  contactPerson?: string;

  @ApiPropertyOptional({ description: 'Follow-up note' })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiProperty({ description: 'ISO 8601 datetime when the follow-up occurred' })
  @IsISO8601()
  occurredAt!: string;
}
